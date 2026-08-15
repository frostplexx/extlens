import type { ScoreBreakdown } from "./scoring.js";
import type { Manifest, SourceFile } from "./types.js";

/**
 * Feature tags. Port of the v0 ExtPorter feature-tagger. Only the feature and
 * code-characteristic tags are ported; the migration-status and issue tags
 * belong to the migration pipeline, not to a pure analyzer.
 */

export const FEATURE_TAGS = [
  "HAS_BROWSER_POPUP",
  "HAS_BACKGROUND_PAGE",
  "HAS_CONTENT_SCRIPTS",
  "HAS_SERVICE_WORKER",
  "NEW_TAB_OVERRIDE",
  "HAS_HOST_PERMISSIONS",
  "USES_WEB_REQUEST",
  "USES_STORAGE_LOCAL",
  "USES_TABS_API",
  "WEBPACK_BUNDLED",
  "CONTAINS_EVAL",
  "MINIFIED_CODE",
] as const;

export type FeatureTag = (typeof FEATURE_TAGS)[number];

// Matches webpack module wrappers like "(0, function (module, exports, ...)".
const WEBPACK_MODULE = /\(\d+,\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/;

function isJs(file: SourceFile): boolean {
  return file.type === "js";
}

function detectCodeCharacteristics(files: SourceFile[]): {
  hasWebpack: boolean;
  hasEval: boolean;
  hasMinified: boolean;
} {
  let hasWebpack = false;
  let hasEval = false;
  let hasMinified = false;

  for (const file of files) {
    if (!isJs(file)) continue;
    const content = file.content;

    if (
      content.includes("__webpack_require__") ||
      content.includes("webpackChunk") ||
      WEBPACK_MODULE.test(content.substring(0, 10000))
    ) {
      hasWebpack = true;
    }
    if (/eval\(/.test(content)) hasEval = true;

    const lines = content.split("\n");
    for (const line of lines) {
      // Minified: very long line with few spaces.
      if (line.length > 500 && line.split(" ").length < line.length / 20) {
        hasMinified = true;
        break;
      }
    }
  }

  return { hasWebpack, hasEval, hasMinified };
}

export function tagExtension(
  manifest: Manifest | undefined,
  breakdown: ScoreBreakdown,
  files: SourceFile[],
): FeatureTag[] {
  const tags = new Set<FeatureTag>();
  const add = (tag: FeatureTag) => tags.add(tag);

  if (manifest?.action || manifest?.browser_action || manifest?.page_action) {
    add("HAS_BROWSER_POPUP");
  }
  if (breakdown.backgroundPage > 0) add("HAS_BACKGROUND_PAGE");
  if (breakdown.contentScripts > 0) add("HAS_CONTENT_SCRIPTS");

  const background = manifest?.background as { service_worker?: unknown } | undefined;
  if (background?.service_worker) add("HAS_SERVICE_WORKER");

  const overrides = manifest?.chrome_url_overrides as { newtab?: unknown } | undefined;
  if (overrides?.newtab) add("NEW_TAB_OVERRIDE");

  if (breakdown.hostPermissions > 0) add("HAS_HOST_PERMISSIONS");
  if (breakdown.webRequest > 0) add("USES_WEB_REQUEST");
  if (breakdown.storageLocal > 0) add("USES_STORAGE_LOCAL");

  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
  if (permissions.includes("tabs") || permissions.includes("activeTab")) add("USES_TABS_API");

  const { hasWebpack, hasEval, hasMinified } = detectCodeCharacteristics(files);
  if (hasWebpack) add("WEBPACK_BUNDLED");
  if (hasEval) add("CONTAINS_EVAL");
  if (hasMinified) add("MINIFIED_CODE");

  return [...tags];
}
