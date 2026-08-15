import type { Browser } from "playwright";

/**
 * CDP extension load detection. After launching a browser with
 * --load-extension, watch its CDP targets for a chrome-extension:// target.
 * The extension id is the URL host. Port of the v0 ExtPorter behavior (its
 * client polled targets after launching with chromiumoxide).
 */

export interface ExtensionTargetInfo {
  extensionId: string;
  url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function detectExtensionLoad(
  browser: Browser,
  timeoutMs = 15000,
): Promise<ExtensionTargetInfo> {
  const cdp = await browser.newBrowserCDPSession();
  try {
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { targetInfos } = (await cdp.send("Target.getTargets")) as {
        targetInfos: { url: string }[];
      };
      const extTarget = targetInfos.find((t) => t.url.startsWith("chrome-extension://"));
      if (extTarget) {
        const extensionId = new URL(extTarget.url).host;
        return { extensionId, url: extTarget.url };
      }
      await sleep(500);
    }
    throw new Error(`no chrome-extension target appeared within ${timeoutMs}ms`);
  } finally {
    await cdp.detach().catch(() => {});
  }
}
