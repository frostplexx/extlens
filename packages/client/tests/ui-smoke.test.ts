import { describe, it, expect } from "vitest";
import { render } from "ink";
import { PassThrough } from "node:stream";
import React from "react";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import { Explorer } from "../src/components/explorer.js";
import { Analyzer } from "../src/components/analyzer.js";
import { StatusBar } from "../src/components/status-bar.js";
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
    manifestVersion: 2,
    score: 87,
    sizeBytes: 12345,
    tags: ["tag-a"],
    hasMv3: true,
    breakdown: { webRequest: 4, htmlLines: 2, extensionSize: 1 },
    manifest: {
      background: { type: "service_worker", scripts: ["bg.js"] },
      permissions: ["storage"],
      hostPermissions: ["<all_urls>"],
      contentScripts: [],
      action: { defaultPopup: "popup.html" },
      optionsPage: null,
      chromeUrlOverrides: { newtab: null },
    },
    listeners: [{ api: "chrome.runtime.onMessage", file: "bg.js", line: 12 }],
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
  it("renders the explorer with toolbar and rows", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    expect(out).toContain("extension explorer");
    expect(out).toContain("search off");
    expect(out).toContain("score↓");
    expect(out).toContain("page 1/3");
    expect(out).toContain("sample-extension");
    expect(out).toContain("▸");
    expect(out).toContain("enter open");
  });

  it("renders the explorer search focus state", async () => {
    const out = await capture(
      React.createElement(Explorer, {
        state: explorerState({ search: "sto", searchFocused: true }),
      }),
    );
    expect(out).toContain("sto▌");
    expect(out).toContain("enter or esc to close");
  });

  it("renders analyzer sections and browser rows", async () => {
    const out = await capture(React.createElement(Analyzer, { state: analyzerState }));
    expect(out).toContain("breakdown");
    expect(out).toContain("manifest");
    expect(out).toContain("listeners");
    expect(out).toContain("chrome.runtime.onMessage");
    expect(out).toContain("mv2 loaded");
    expect(out).toContain("b launch");
  });

  it("renders the status bar with ssh label", async () => {
    const out = await capture(
      React.createElement(StatusBar, {
        status: "connected",
        message: null,
        tab: "explorer",
        sshLabel: "myserver",
        tunnel: "up",
      }),
    );
    expect(out).toContain("● connected");
    expect(out).toContain("ssh myserver");
    expect(out).toContain("[explorer]");
  });
});
