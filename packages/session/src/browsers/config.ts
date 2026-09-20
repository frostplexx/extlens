import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { installedExecutable } from "./install.js";

/**
 * Where the test browsers come from.
 *
 * Environment variables were the only configuration when the client was a terminal; an app has
 * a settings page, and both have to agree. So the answer lives here as one mutable record: the
 * environment fills it at load, the app overwrites what the user set, and every lookup reads it
 * at call time rather than capturing a value at import.
 */
export interface BrowserConfig {
  /** Install dir for downloaded Chrome for Testing builds. */
  dir: string;
  /** Explicit executables per label; null means "find one". */
  executables: { mv2: string | null; mv3: string | null };
}

const config: BrowserConfig = {
  // EXLENS_* (missing T) was the original spelling; both work, documented one wins.
  dir: process.env.EXTLENS_BROWSER_DIR ?? process.env.EXLENS_BROWSER_DIR ?? "/tmp/extlens",
  executables: { mv2: process.env.CHROME_OLD ?? null, mv3: process.env.CHROME_LATEST ?? null },
};

export function browserConfig(): BrowserConfig {
  return { dir: config.dir, executables: { ...config.executables } };
}

export function setBrowserConfig(next: Partial<BrowserConfig>): void {
  if (next.dir !== undefined) config.dir = next.dir;
  if (next.executables) config.executables = { ...config.executables, ...next.executables };
}

export function browserDir(): string {
  return config.dir;
}

/** Where a label's executable came from, for a settings page to say so. */
export type ExecutableSource = "configured" | "installed" | "bundled";

export interface ResolvedExecutable {
  path: string;
  source: ExecutableSource;
}

/**
 * The executable for a label, and why. A configured path that does not exist is skipped rather
 * than failed on: the user may have moved a browser, and a working install underneath it beats
 * an error. The settings page shows the configured value separately, so nothing is hidden.
 */
export function resolveExecutableDetailed(label: "mv2" | "mv3"): ResolvedExecutable | null {
  const configured = config.executables[label];
  if (configured && existsSync(configured)) return { path: configured, source: "configured" };
  const installed = installedExecutable(label);
  if (installed) return { path: installed, source: "installed" };
  // MV3 falls back to playwright's bundled chromium; MV2 cannot (recent chromium builds no longer
  // load MV2 extensions). A missing result means the app offers to download Chrome for Testing.
  if (label === "mv3") {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return { path: bundled, source: "bundled" };
  }
  return null;
}

export function resolveExecutable(label: "mv2" | "mv3"): string | null {
  return resolveExecutableDetailed(label)?.path ?? null;
}
