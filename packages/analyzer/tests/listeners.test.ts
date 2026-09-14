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

  test("reads inline scripts in HTML, where popup logic often lives", () => {
    // Skipping HTML meant an extension whose whole UI is a popup could report no events at all.
    const withHtml = [
      ...files,
      { path: "popup.html", type: "html" as const, content: "<script>chrome.tabs.onRemoved.addListener(() => {})</script>" },
    ];
    const found = extractListeners(withHtml);
    expect(found.some((l) => l.api === "chrome.tabs.onRemoved" && l.file === "popup.html")).toBe(true);
  });

  test("ignores files that are neither script nor markup", () => {
    const withCss = [...files, { path: "a.css", type: "css" as const, content: "chrome.runtime.onMessage.addListener()" }];
    expect(extractListeners(withCss).some((l) => l.file === "a.css")).toBe(false);
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

describe("things the reviewer has to go and look for", () => {
  const from = (content: string) => extractListeners([{ path: "bg.js", type: "js" as const, content }]);

  test("finds a right-click entry, which arrives through create() and not a listener", () => {
    const found = from("chrome.contextMenus.create({ id: 'x', title: 'Do it' });");
    expect(found.map((l) => l.api)).toEqual(["chrome.contextMenus.create"]);
    expect(found[0].kind).toBe("call");
  });

  test("finds notifications, badges and alarms", () => {
    expect(from("chrome.notifications.create({})").map((l) => l.api)).toEqual(["chrome.notifications.create"]);
    expect(from("chrome.action.setBadgeText({text:'1'})").map((l) => l.api)).toEqual(["chrome.action.setBadgeText"]);
    expect(from("chrome.alarms.create('tick', {})").map((l) => l.api)).toEqual(["chrome.alarms.create"]);
  });

  test("finds the MV2 spellings too", () => {
    expect(from("chrome.browserAction.setBadgeText({})").map((l) => l.api)).toEqual([
      "chrome.browserAction.setBadgeText",
    ]);
  });

  test("tags a listener as a listener", () => {
    expect(from("chrome.contextMenus.onClicked.addListener(() => {})")[0]).toMatchObject({
      api: "chrome.contextMenus.onClicked",
      kind: "listener",
    });
  });
});

describe("namespaces that nest", () => {
  const from = (content: string) => extractListeners([{ path: "d.js", type: "js" as const, content }]);

  test("finds a two-level namespace", () => {
    expect(from("chrome.devtools.network.onRequestFinished.addListener(() => {})").map((l) => l.api)).toEqual([
      "chrome.devtools.network.onRequestFinished",
    ]);
  });

  test("finds addRules registrations, not just addListener", () => {
    expect(from("chrome.declarativeContent.onPageChanged.addRules([])").map((l) => l.api)).toEqual([
      "chrome.declarativeContent.onPageChanged",
    ]);
  });
});
