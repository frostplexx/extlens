/**
 * Scoring weights and breakdown type. Port of the v0 ExtPorter
 * scoring-config.ts, renamed to camelCase. The migration-specific weights
 * (apiRenames, manifestChanges, fileModifications, webRequestToDnr) are kept
 * in the breakdown type so hosts with existing analysis can fill them, but the
 * pure analyzer always emits 0 for them.
 */

export const WEIGHTS = {
  webRequest: 5,
  htmlLines: 0.25,
  storageLocal: 5,
  backgroundPage: 10,
  contentScripts: 4,
  dangerousPermissions: 3,
  hostPermissions: 3,
  cryptoPatterns: 5,
  networkRequests: 2,
  extensionSize: 1,
  apiRenames: 10,
  manifestChanges: 5,
  fileModifications: 2,
  webRequestToDnr: 20,
} as const;

export type WeightKey = keyof typeof WEIGHTS;

/** Permissions that raise the interestingness score. Port of v0. */
export const DANGEROUS_PERMISSIONS: ReadonlySet<string> = new Set([
  "tabs",
  "activeTab",
  "cookies",
  "history",
  "bookmarks",
  "management",
  "privacy",
  "proxy",
  "downloads",
  "nativeMessaging",
  "webRequest",
  "webRequestBlocking",
  "declarativeNetRequest",
]);

/** Raw per-dimension counts, before weighting. */
export interface ScoreBreakdown {
  webRequest: number;
  htmlLines: number;
  storageLocal: number;
  backgroundPage: number;
  contentScripts: number;
  dangerousPermissions: number;
  hostPermissions: number;
  cryptoPatterns: number;
  networkRequests: number;
  extensionSize: number;
  apiRenames: number;
  manifestChanges: number;
  fileModifications: number;
  webRequestToDnr: number;
}

export function emptyBreakdown(): ScoreBreakdown {
  return {
    webRequest: 0,
    htmlLines: 0,
    storageLocal: 0,
    backgroundPage: 0,
    contentScripts: 0,
    dangerousPermissions: 0,
    hostPermissions: 0,
    cryptoPatterns: 0,
    networkRequests: 0,
    extensionSize: 0,
    apiRenames: 0,
    manifestChanges: 0,
    fileModifications: 0,
    webRequestToDnr: 0,
  };
}

/** Weighted total, rounded like v0. */
export function scoreBreakdown(breakdown: ScoreBreakdown): number {
  const total = (Object.entries(breakdown) as [WeightKey, number][]).reduce(
    (sum, [key, value]) => sum + value * WEIGHTS[key],
    0,
  );
  return Math.round(total);
}
