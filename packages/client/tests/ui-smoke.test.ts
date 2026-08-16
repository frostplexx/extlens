import { describe, it, expect } from "vitest";
import { render, Text } from "ink";
import { PassThrough } from "node:stream";
import React from "react";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import { Explorer } from "../src/components/explorer.js";
import { Analyzer } from "../src/components/analyzer.js";
import { StatusBar } from "../src/components/status-bar.js";
import { TopBar, HostStatusView, listPageSize } from "../src/components/ui.js";
import type { AnalyzerState, ExplorerState } from "../src/types.js";

/**
 * Renders the tab components through ink and asserts on the plain-text
 * output. Guards against JSX structure breakage (Text inside Box, etc.)
 * without a TTY.
 */
async function capture(node: React.ReactElement): Promise<string> {
  const stdout = new PassThrough();
  let out = "";
  stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  const instance = render(node, { stdout } as never);
  await new Promise((r) => setTimeout(r, 80));
  instance.unmount();
  return out.replace(/\u001b\[[0-9;]*m/g, "");
}

const light: ExtensionLight = {
  id: "e1",
  name: "sample-extension",
  version: "1.2.3",
  manifestVersion: 2,
  score: 87,
  hasMv3: true,
  tags: ["tag-a"],
};

const stats: ListStats = { total: 2, analyzed: 2, withMv3: 1, avgScore: 64 };

function explorerState(over: Partial<ExplorerState>): ExplorerState {
  return {
    lights: [light],
    stats,
    page: 1,
    totalPages: 3,
    search: "",
    searchFocused: false,
    sort: "interestingness_desc",
    selectedIndex: 0,
    loading: false,
    error: null,
    ...over,
  };
}

const analyzerState: AnalyzerState = {
  id: "e1",
  profile: {
    id: "e1",
    name: "sample-extension",
    version: "1.2.3",
    manifestVersion: 3,
    score: 87,
    sizeBytes: 12345,
    tags: [],
    hasMv3: true,
    breakdown: {
      webRequest: 4,
      htmlLines: 2,
      storageLocal: 1,
      backgroundPage: 1,
      contentScripts: 1,
      dangerousPermissions: 1,
      hostPermissions: 1,
      cryptoPatterns: 1,
      networkRequests: 1,
      extensionSize: 1,
      apiRenames: 0,
      manifestChanges: 0,
      fileModifications: 0,
      webRequestToDnr: 0,
    },
    manifest: {
      manifestVersion: 3,
      name: "sample-extension",
      version: "1.2.3",
      description: "Generates deep links for AliExpress",
      id: "jfpmipfmnoleakbnehmhhoefgofjilba",
      permissions: ["storage"],
      hostPermissions: ["<all_urls>"],
      background: { type: "service_worker", scripts: ["bg.js"] },
      contentScripts: [],
      action: { defaultPopup: "popup.html", defaultTitle: null },
      optionsPage: null,
      chromeUrlOverrides: { newtab: null },
    },
    mv2: {
      manifestVersion: 2,
      name: "DeepAli (mv2)",
      version: "1.0.9",
      description: "mv2 description",
      id: "jfpmipfmnoleakbnehmhhoefgofjilba",
      permissions: ["storage", "tabs"],
      hostPermissions: [],
      background: { type: "page", scripts: ["background.js"] },
      contentScripts: [],
      action: null,
      optionsPage: null,
      chromeUrlOverrides: { newtab: null },
    },
    listeners: [
      { api: "chrome.runtime.onMessage", file: "bg.js", line: 12, snippet: "chrome.runtime.onMessage.addListener" },
    ],
  },
  files: { mv2: "/tmp/x/mv2" },
  report: null,
  loading: false,
  error: null,
  mv2: { phase: "loaded", message: "ready", extensionId: "a" },
  mv3: { phase: "idle", message: null, extensionId: null },
  formOpen: false,
  prompt: null,
};

describe("ui rendering", () => {
  it("sizes list pages to the terminal", () => {
    expect(listPageSize(24)).toBe(17);
    expect(listPageSize(50)).toBe(40);
    expect(listPageSize(10)).toBe(5);
    expect(listPageSize(undefined)).toBe(17);
  });

  it("renders the top bar with title and right controls", async () => {
    const out = await capture(
      React.createElement(TopBar, {
        title: "extension explorer",
        right: React.createElement(Text, null, "search off (/)"),
      }),
    );
    expect(out).toContain("extlens — extension explorer");
    expect(out).toContain("search off (/)");
  });

  it("renders host lifecycle states", async () => {
    const view = (status: any) =>
      capture(React.createElement(HostStatusView, { status }));
    expect(await view({ state: "idle", phase: null, extensionId: null, startedAt: null, message: null })).toContain("idle");
    expect(
      await view({ state: "running", phase: "preparing", extensionId: "one-ext", startedAt: "t", message: null }),
    ).toContain("running one-ext");
    expect(
      await view({ state: "running", phase: "migrating", extensionId: "one-ext", startedAt: "t", message: null }),
    ).toContain("migrating");
    expect(
      await view({ state: "idle", phase: "done", extensionId: "one-ext", startedAt: "t", message: null }),
    ).toContain("done one-ext");
    expect(
      await view({ state: "idle", phase: "failed", extensionId: "one-ext", startedAt: "t", message: null }),
    ).toContain("failed one-ext");
    expect(await view(null)).toContain("host …");
  });

  it("renders explorer rows without tags", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    expect(out).toContain("sample-extension");
    expect(out).toContain("▸");
    expect(out).not.toContain("enter open");
    expect(out).not.toContain("tag-a");
  });

  it("renders analyzer sections and browser rows", async () => {
    const out = await capture(React.createElement(Analyzer, { state: analyzerState }));
    expect(out).toContain("breakdown");
    expect(out).toContain("manifest (mv3)");
    expect(out).toContain("manifest (mv2)");
    expect(out).toContain("jfpmipfmnoleakbnehmhhoefgofjilba");
    expect(out).toContain("Generates deep links for AliExpress");
    expect(out).toContain("listeners");
    expect(out).toContain("chrome.runtime.onMessage");
    expect(out).toContain("mv2 loaded");
    expect(out).not.toContain("b launch");
  });

  it("renders the status bar with ssh label and hints", async () => {
    const out = await capture(
      React.createElement(StatusBar, {
        status: "connected",
        message: null,
        tab: "explorer",
        sshLabel: "myserver",
        tunnel: "up",
        hints: "↑/↓ select · enter open · q quit",
      }),
    );
    expect(out).toContain("● connected");
    expect(out).toContain("ssh myserver");
    expect(out).toContain("[explorer]");
    expect(out).toContain("↑/↓ select · enter open · q quit");
  });
});
