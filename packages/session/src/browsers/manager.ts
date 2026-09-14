import { existsSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { detectExtensionLoad } from "./load-status.js";
import { installedExecutable } from "./install.js";
import type { BrowserState } from "../types.js";

/**
 * Dual-browser review flow. MV2 uses CHROME_OLD (a Chromium build that still
 * supports MV2, e.g. Chrome 109); MV3 uses CHROME_LATEST or playwright's
 * bundled chromium. Browsers launch visible with --load-extension so the
 * reviewer can exercise the extension by hand.
 */

export interface BrowserLaunchSpec {
  label: "mv2" | "mv3";
  executable: string | null;
  extensionPath: string;
}

const V0_FLAGS = [
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-sync",
  "--no-first-run",
  "--password-store=basic",
  "--use-mock-keychain",
];

export function resolveExecutable(label: "mv2" | "mv3"): string | null {
  const fromEnv = label === "mv2" ? process.env.CHROME_OLD : process.env.CHROME_LATEST;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const installed = installedExecutable(label);
  if (installed) return installed;
  // MV3 falls back to playwright's bundled chromium; MV2 cannot (recent
  // chromium builds no longer load MV2 extensions). A missing result means
  // the app offers to download Chrome for Testing.
  if (label === "mv3") {
    const bundled = chromium.executablePath();
    return bundled && existsSync(bundled) ? bundled : null;
  }
  return null;
}

export class BrowserManager {
  /** Live contexts, labelled, so a page can be opened in each and reported per browser. */
  private contexts: { label: "mv2" | "mv3"; context: BrowserContext }[] = [];

  /** Launch one browser and detect the extension load. Updates `state`. */
  async launch(
    spec: BrowserLaunchSpec,
    state: BrowserState,
    setState: (next: BrowserState) => void,
  ): Promise<void> {
    if (!spec.executable) {
      setState({
        phase: "failed",
        message: `no ${spec.label === "mv2" ? "CHROME_OLD" : "CHROME_LATEST / bundled chromium"} — set CHROME_OLD (MV2 needs a Chromium build that still supports MV2)`,
        extensionId: null,
      });
      return;
    }

    setState({ phase: "launching", message: "launching…", extensionId: null });
    try {
      const context = await chromium.launchPersistentContext("", {
        headless: false,
        executablePath: spec.executable,
        // Playwright's default args include --disable-extensions, which would
        // silently drop --load-extension (the ExtPorter analyzer client removes
        // the same flag via chromiumoxide's disable_default_args).
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [`--load-extension=${spec.extensionPath}`, "--no-sandbox", ...V0_FLAGS],
      });
      this.contexts.push({ label: spec.label, context });
      const browser = context.browser();
      if (!browser) throw new Error("no browser handle");

      setState({ phase: "detecting", message: "waiting for extension target…", extensionId: null });
      const info = await detectExtensionLoad(browser);
      setState({
        phase: "loaded",
        message: `loaded as ${info.extensionId}`,
        extensionId: info.extensionId,
      });
    } catch (error) {
      setState({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
        extensionId: null,
      });
    }
  }

  /**
   * Open a page in every running browser.
   *
   * The point is side-by-side: the same URL in the MV2 and MV3 windows is what makes a content
   * script's behaviour comparable rather than remembered. A browser that fails to navigate is
   * reported rather than throwing, since the other one may well have worked.
   */
  async openUrl(url: string): Promise<{ label: "mv2" | "mv3"; ok: boolean; error?: string }[]> {
    return Promise.all(
      this.contexts.map(async ({ label, context }) => {
        try {
          const page = await context.newPage();
          // Not networkidle: an ad-heavy page may never reach it, and the reviewer only needs the
          // page to be there to look at.
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          return { label, ok: true };
        } catch (error) {
          return { label, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.contexts.map(({ context }) => context.close().catch(() => {})));
    this.contexts = [];
  }

  get activeCount(): number {
    return this.contexts.length;
  }
}
