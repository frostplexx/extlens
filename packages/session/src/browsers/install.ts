import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

/**
 * Chrome for Testing install. When a browser is missing, the client offers to
 * download the matching Chrome for Testing build and cache it under
 * EXTLENS_BROWSER_DIR (default /tmp/extlens) so the analyzer can launch it.
 */

export const BROWSER_DIR = process.env.EXTLENS_BROWSER_DIR ?? process.env.EXLENS_BROWSER_DIR ?? "/tmp/extlens";

const KNOWN_GOOD_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json";
const LAST_KNOWN_GOOD_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

/** Last Chrome for Testing build that loads MV2 extensions without policy. */
export const MV2_CHROME_VERSION = "116.0.5845.96";

type ChromePlatform = "linux64" | "mac-arm64" | "mac-x64" | "win32" | "win64";

export function platformKey(): ChromePlatform {
  if (process.platform === "darwin") return process.arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (process.platform === "linux") return "linux64";
  return "win64";
}

export interface ChromeDownload {
  version: string;
  platform: string;
  url: string;
  zip: string;
}

interface ChromeBuild {
  version: string;
  platform: string;
  url: string;
  zip: string;
}

function buildZip(url: string): string {
  const name = url.split("/").pop();
  if (!name) throw new Error(`chrome for testing: cannot derive archive name from ${url}`);
  return name;
}

function pickBuild(chromeDownloads: ChromeBuild[], platform: ChromePlatform): ChromeBuild {
  const exact = chromeDownloads.find((d) => d.platform === platform);
  if (exact) return exact;
  // Old builds lack mac-arm64; Intel builds run under Rosetta on Apple Silicon.
  const fallback =
    platform === "mac-arm64" ? chromeDownloads.find((d) => d.platform === "mac-x64") : null;
  if (fallback) return fallback;
  throw new Error(`no Chrome for Testing build for ${platform}`);
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chrome for Testing lookup failed (HTTP ${res.status})`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Resolve the download for a browser label without downloading anything. */
export async function fetchChromeDownload(label: "mv2" | "mv3"): Promise<ChromeDownload> {
  const platform = platformKey();
  if (label === "mv3") {
    const data = await fetchJson(LAST_KNOWN_GOOD_URL);
    const stable = data.channels as {
      Stable?: { version: string; downloads?: { chrome?: ChromeBuild[] } };
    };
    const downloads = stable?.Stable?.downloads?.chrome;
    if (!downloads) throw new Error("Chrome for Testing: no stable channel data");
    const build = pickBuild(downloads, platform);
    if (!stable.Stable) throw new Error("Chrome for Testing: no stable channel data");
    return {
      version: stable.Stable.version,
      platform: build.platform,
      url: build.url,
      zip: buildZip(build.url),
    };
  }
  const data = await fetchJson(KNOWN_GOOD_URL);
  const versions = (data.versions as { version: string; downloads?: { chrome?: ChromeBuild[] } }[]) ?? [];
  const pinned =
    versions.find((v) => v.version === MV2_CHROME_VERSION) ?? versions[0] ?? null;
  if (!pinned || !pinned.downloads?.chrome) throw new Error("Chrome for Testing: version list is empty");
  const build = pickBuild(pinned.downloads.chrome, platform);
  return { version: pinned.version, platform: build.platform, url: build.url, zip: buildZip(build.url) };
}

/** Cached install for a label, or null. Reads /tmp/extlens/<label>/path.txt. */
export function installedExecutable(label: "mv2" | "mv3"): string | null {
  const cachePath = join(BROWSER_DIR, label, "path.txt");
  if (!existsSync(cachePath)) return null;
  const path = readFileSync(cachePath, "utf8").trim();
  return path && existsSync(path) ? path : null;
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPct = -1;
  const file = createWriteStream(dest);
  try {
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of body) {
      received += chunk.length;
      if (onProgress && total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          onProgress(pct);
        }
      }
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) => file.once("drain", resolve));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      file.end((err: Error | null) => (err ? reject(err) : resolve())),
    );
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  try {
    await run("unzip", ["-o", "-q", zipPath, "-d", destDir]);
    return;
  } catch {
    // fall through to ditto (macOS)
  }
  try {
    await run("ditto", ["-x", "-k", zipPath, destDir]);
    return;
  } catch {
    throw new Error(`cannot extract ${zipPath}: unzip and ditto are both unavailable`);
  }
}

/** Binary path inside an extracted Chrome for Testing archive. */
export function chromeBinaryPath(installRoot: string, zipName: string): string {
  const base = join(installRoot, zipName.replace(/\.zip$/, ""));
  const candidates =
    process.platform === "darwin"
      ? [join(base, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")]
      : process.platform === "win32"
        ? [join(base, "chrome.exe")]
        : [join(base, "chrome")];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("downloaded archive: chrome binary not found");
  return found;
}

/**
 * Install Chrome for Testing for a label. Returns the executable path.
 * Reuses a cached install. onProgress reports download percentage.
 */
export async function installChrome(
  label: "mv2" | "mv3",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const cached = installedExecutable(label);
  if (cached) return cached;

  const download = await fetchChromeDownload(label);
  const dir = join(BROWSER_DIR, label);
  await mkdir(dir, { recursive: true });
  const zipPath = join(BROWSER_DIR, `chrome-${label}-${download.version}.zip`);
  await downloadFile(download.url, zipPath, onProgress);

  const installRoot = join(dir, download.version);
  await extractZip(zipPath, installRoot);
  const binary = chromeBinaryPath(installRoot, download.zip);
  await chmod(binary, 0o755).catch(() => {});
  await writeFile(join(dir, "path.txt"), binary);
  return binary;
}

export function missingBrowserMessage(label: "mv2" | "mv3"): string {
  return label === "mv2"
    ? "no MV2-capable chrome found (CHROME_OLD unset or missing)"
    : "no chrome found (CHROME_LATEST unset and no bundled chromium)";
}
