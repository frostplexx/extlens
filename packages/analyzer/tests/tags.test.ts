import { describe, expect, test } from "bun:test";
import { analyzeExtension } from "../src/index.js";
import { loadFixture } from "./helpers.js";

describe("one-ext tags", () => {
  const profile = analyzeExtension(loadFixture("one-ext"));

  test("feature and permission tags", () => {
    expect(profile.tags).toEqual([
      "HAS_BROWSER_POPUP",
      "HAS_BACKGROUND_PAGE",
      "HAS_CONTENT_SCRIPTS",
      "NEW_TAB_OVERRIDE",
      "HAS_HOST_PERMISSIONS",
      "USES_WEB_REQUEST",
      "USES_STORAGE_LOCAL",
      "USES_TABS_API",
    ]);
  });
});

describe("webpack-bundled tags", () => {
  const profile = analyzeExtension(loadFixture("corpus-a/webpack-bundled"));

  test("code characteristic tags", () => {
    expect(profile.tags).toEqual([
      "HAS_BROWSER_POPUP",
      "HAS_BACKGROUND_PAGE",
      "USES_STORAGE_LOCAL",
      "WEBPACK_BUNDLED",
      "CONTAINS_EVAL",
      "MINIFIED_CODE",
    ]);
  });

  test("no service worker tag for MV2 background scripts", () => {
    expect(profile.tags).not.toContain("HAS_SERVICE_WORKER");
  });
});

describe("minimal tags", () => {
  const profile = analyzeExtension(loadFixture("corpus-a/minimal"));

  test("only the popup tag", () => {
    expect(profile.tags).toEqual(["HAS_BROWSER_POPUP"]);
  });
});

describe("service worker tag", () => {
  test("MV3 background.service_worker adds HAS_SERVICE_WORKER", () => {
    const profile = analyzeExtension({
      id: "mv3",
      manifest: {
        manifest_version: 3,
        name: "MV3",
        background: { service_worker: "sw.js" },
      },
      files: [{ path: "sw.js", type: "js", content: "chrome.runtime.onInstalled.addListener(() => {})" }],
    });
    expect(profile.tags).toContain("HAS_SERVICE_WORKER");
    expect(profile.manifestVersion).toBe(3);
  });
});
