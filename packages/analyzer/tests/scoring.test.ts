import { describe, expect, test } from "bun:test";
import { analyzeExtension } from "../src/index.js";
import { loadFixture } from "./helpers.js";

/**
 * Golden numbers hand-computed from the v0 weights on the synthetic fixtures.
 * Any change to the analyzer that moves these numbers must be a deliberate
 * scoring change, not an accident.
 */

describe("one-ext", () => {
  const profile = analyzeExtension(loadFixture("one-ext"));

  test("metadata", () => {
    expect(profile.id).toBe("one-ext");
    expect(profile.name).toBe("One Ext");
    expect(profile.version).toBe("1.2.3");
    expect(profile.manifestVersion).toBe(2);
  });

  test("breakdown", () => {
    expect(profile.breakdown).toEqual({
      webRequest: 2, // two chrome.webRequest.* calls in background.js
      htmlLines: 33, // 3 html files, incl. trailing newline per file
      storageLocal: 3, // get + set in background.js, set in popup.js
      backgroundPage: 1,
      contentScripts: 1,
      dangerousPermissions: 4, // tabs, cookies, webRequest, webRequestBlocking
      hostPermissions: 1, // "*://*.example.com/*"
      cryptoPatterns: 2, // btoa( + atob( in content.js
      networkRequests: 3, // fetch( x2, XMLHttpRequest x1
      extensionSize: 0, // 2628 bytes < 100KB
      apiRenames: 0,
      manifestChanges: 0,
      fileModifications: 0,
      webRequestToDnr: 0,
    });
  });

  test("score", () => {
    // 2*5 + 33*0.25 + 3*5 + 10 + 4 + 4*3 + 1*3 + 2*5 + 3*2 = 78.25 -> 78
    expect(profile.score).toBe(78);
  });

  test("size", () => {
    expect(profile.sizeBytes).toBe(2628);
  });
});

describe("webpack-bundled", () => {
  const profile = analyzeExtension(loadFixture("corpus-a/webpack-bundled"));

  test("breakdown", () => {
    expect(profile.breakdown).toEqual({
      webRequest: 0,
      htmlLines: 11,
      storageLocal: 1, // chrome.storage.local.get in bundle.js
      backgroundPage: 1,
      contentScripts: 0,
      dangerousPermissions: 0,
      hostPermissions: 0,
      cryptoPatterns: 1, // eval( in bundle.js
      networkRequests: 1, // fetch( in bundle.js
      extensionSize: 0,
      apiRenames: 0,
      manifestChanges: 0,
      fileModifications: 0,
      webRequestToDnr: 0,
    });
  });

  test("score", () => {
    // 11*0.25 + 5 + 10 + 5 + 2 = 24.75 -> 25
    expect(profile.score).toBe(25);
  });

  test("size", () => {
    expect(profile.sizeBytes).toBe(1958);
  });
});

describe("minimal", () => {
  const profile = analyzeExtension(loadFixture("corpus-a/minimal"));

  test("breakdown is all zeros except htmlLines", () => {
    expect(profile.breakdown).toEqual({
      webRequest: 0,
      htmlLines: 10,
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
    });
  });

  test("score", () => {
    // 10*0.25 = 2.5 -> 3
    expect(profile.score).toBe(3);
  });

  test("size", () => {
    expect(profile.sizeBytes).toBe(396);
  });
});

describe("pure function guarantees", () => {
  test("does not mutate the input source", () => {
    const source = loadFixture("one-ext");
    const manifestBefore = JSON.stringify(source.manifest);
    const filesBefore = JSON.stringify(source.files);
    analyzeExtension(source);
    expect(JSON.stringify(source.manifest)).toBe(manifestBefore);
    expect(JSON.stringify(source.files)).toBe(filesBefore);
  });
});
