import { describe, expect, test } from "vitest";
import { extractListeners } from "../src/listener-extractor.js";
import { loadFixture } from "./helpers.js";

describe("one-ext listeners", () => {
  const listeners = extractListeners(loadFixture("one-ext").files);

  test("extracts all five listeners sorted by api then file", () => {
    expect(listeners.map((l) => `${l.api}@${l.file}:${l.line}`)).toEqual([
      "chrome.runtime.onMessage@background.js:1",
      "chrome.runtime.onMessage@content.js:1",
      "chrome.tabs.onUpdated@background.js:20",
      "chrome.webRequest.onBeforeRequest@background.js:8",
      "chrome.webRequest.onHeadersReceived@background.js:14",
    ]);
  });

  test("records snippets", () => {
    const first = listeners[0];
    expect(first.snippet).toBe(
      "chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {",
    );
  });
});

describe("listener extraction rules", () => {
  const files = [
    {
      path: "background.js",
      type: "js" as const,
      content: [
        "chrome.runtime.onMessage.addListener(() => {})",
        "chrome.runtime.onMessage.addListener(() => {})", // duplicate in same file
        "browser.tabs.onUpdated.addListener(() => {})",
        "chrome.tabs.onUpdated.addListener(() => {})",
      ].join("\n"),
    },
    {
      path: "content.js",
      type: "js" as const,
      content: "chrome.runtime.onMessage.addListener(() => {})",
    },
  ];

  test("dedupes per api+file", () => {
    const listeners = extractListeners(files);
    expect(listeners).toHaveLength(4);
    // duplicate onMessage in background.js appears once; content.js copy kept
    const onMessage = listeners.filter((l) => l.api === "chrome.runtime.onMessage");
    expect(onMessage.map((l) => l.file)).toEqual(["background.js", "content.js"]);
  });

  test("records correct line numbers", () => {
    const listeners = extractListeners(files);
    const tabs = listeners.find((l) => l.api === "chrome.tabs.onUpdated");
    expect(tabs?.file).toBe("background.js");
    expect(tabs?.line).toBe(4);
  });

  test("ignores non-js files", () => {
    const withHtml = [...files, { path: "popup.html", type: "html" as const, content: "chrome.runtime.onMessage.addListener()" }];
    expect(extractListeners(withHtml)).toHaveLength(4);
  });

  test("matches browser.* namespace", () => {
    const browserOnly = [{ path: "b.js", type: "js" as const, content: "browser.storage.onChanged.addListener(() => {})" }];
    const listeners = extractListeners(browserOnly);
    expect(listeners.map((l) => l.api)).toEqual(["browser.storage.onChanged"]);
  });
});

describe("minimal listeners", () => {
  test("none extracted", () => {
    expect(extractListeners(loadFixture("corpus-a/minimal").files)).toEqual([]);
  });
});
