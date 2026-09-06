import { describe, it, expect } from "vitest";
import { render } from "ink";
import { PassThrough } from "node:stream";
import React from "react";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import { Explorer } from "../src/components/explorer.js";
import { Analyzer } from "../src/components/analyzer.js";
import { StatusBar } from "../src/components/status-bar.js";
import { TopBar, HostStatusView, LogView, HelpView, listPageSize, formatError, isCompact, MIN_ROWS } from "../src/components/ui.js";
import type { AnalyzerState, ExplorerState } from "../src/types.js";

/**
 * Renders the tab components through ink and asserts on the plain-text
 * output. Guards against JSX structure breakage (Text inside Box, etc.)
 * without a TTY.
 */
async function capture(
  node: React.ReactElement,
  size?: { columns?: number; rows?: number },
): Promise<string> {
  const stdout = new PassThrough();
  if (size) Object.assign(stdout, size);
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
  hasReport: true,
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
  prompts: [],
  scroll: 0,
};

describe("ui rendering", () => {
  it("sizes list pages to the terminal", () => {
    // One row smaller than before: the list panel now carries a column-header row.
    expect(listPageSize(24)).toBe(8);
    expect(listPageSize(50)).toBe(34);
    expect(listPageSize(undefined)).toBe(8);
    // Short terminals switch to compact chrome and may shrink to a single row. The old
    // five-row floor forced a 21-row frame, which overflowed every terminal below that.
    expect(listPageSize(20)).toBe(7);
    expect(listPageSize(14)).toBe(1);
    expect(listPageSize(10)).toBe(1);
  });

  it("keeps the whole frame within the terminal height", () => {
    // Regression: the frame was always >= 21 rows, so anything shorter scrolled its own
    // top off screen. chrome + list must never exceed the terminal.
    for (const rows of [14, 16, 18, 20, 24, 30, 40]) {
      const chrome = isCompact(rows) ? 13 : 16;
      expect(chrome + listPageSize(rows)).toBeLessThanOrEqual(rows);
    }
    expect(MIN_ROWS).toBe(14);
  });

  it("renders the menu bar with brand and connection status", async () => {
    const out = await capture(React.createElement(TopBar, { status: "connected" }));
    expect(out).toContain("extlens");
    expect(out).toContain("connected");
    expect(out).not.toContain("Explorer");
    expect(out).not.toContain("Analyzer");
    expect(out).not.toContain("Log");
  });

  it("renders each connection state in the menu bar", async () => {
    const view = (status: "connecting" | "connected" | "disconnected") =>
      capture(React.createElement(TopBar, { status }));
    expect(await view("connected")).toContain("connected");
    expect(await view("connecting")).toContain("connecting");
    expect(await view("disconnected")).toContain("disconnected");
  });

  it("renders the log view with the host message fallback", async () => {
    const out = await capture(
      React.createElement(LogView, {
        status: {
          state: "idle",
          phase: "failed",
          extensionId: "e1",
          startedAt: null,
          message: "python -m src.run failed: docker image not found",
        },
        lines: [],
        error: null,
      }),
    );
    expect(out).toContain("host log (failed)");
    expect(out).toContain("docker image not found");
  });

  it("renders a placeholder in the log view without a message", async () => {
    const out = await capture(
      React.createElement(LogView, { status: null, lines: [], error: null }),
    );
    expect(out).toContain("no output from the host yet");
  });

  it("renders structured log lines and omits overflow", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      seq: i + 1,
      ts: "2025-01-01T00:00:00.000Z",
      stream: (i % 2 === 0 ? "stdout" : "stderr") as "stdout" | "stderr",
      text: `entry-${String(i + 1).padStart(2, "0")}`,
    }));
    const out = await capture(
      React.createElement(LogView, { status: null, lines, error: null }),
    );
    expect(out).toContain("… 7 earlier lines omitted");
    expect(out).toContain("entry-20");
    expect(out).not.toContain("entry-01");
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

  it("renders explorer with split panels and details for the selected row", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    expect(out).toContain("sample-extension");
    expect(out).toContain("▶");
    expect(out).toContain("/ to search");
    expect(out).toContain("Extensions (2)");
    expect(out).toContain("Details");
    expect(out).toContain("Total: 2");
    expect(out).toContain("Avg Score: 64.0");
    expect(out).toContain("Version: 1.2.3");
    expect(out).not.toContain("[tag-a]");
    expect(out).not.toContain("█");
    expect(out).not.toContain("enter open");
  });

  it("pads the name so the mv marker sits in a fixed column", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    // The name column is sized from the panel width now, so assert the alignment property
    // (name padded, then " mvN") rather than one hardcoded pad width.
    expect(out).toMatch(/sample-extension {2,} mv2/);
  });

  it("labels the list columns", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    expect(out).toContain("score");
    expect(out).toContain("name");
    expect(out).toContain("ver");
  });

  it("grows the name column with the terminal instead of capping it at 18", async () => {
    const long = { ...light, name: "an-extension-with-a-very-long-name-indeed" };
    const narrow = await capture(
      React.createElement(Explorer, { state: explorerState({ lights: [long] }) }),
      { columns: 80 },
    );
    const wide = await capture(
      React.createElement(Explorer, { state: explorerState({ lights: [long] }) }),
      { columns: 200 },
    );
    const shown = (out: string) => (out.match(/an-extension-with-a-very-long-name-indeed/) ? 99 : (out.match(/an-extension[-a-z]*/)?.[0].length ?? 0));
    expect(shown(wide)).toBeGreaterThan(shown(narrow));
  });

  it("marks a tested row with the check icon and hides the migrated icon", async () => {
    const out = await capture(React.createElement(Explorer, { state: explorerState({}) }));
    expect(out).toContain("✓");
    expect(out).not.toContain("↑");
  });

  it("marks a migrated-but-untested row with the migrate icon", async () => {
    const out = await capture(
      React.createElement(Explorer, {
        state: explorerState({ lights: [{ ...light, hasMv3: true, hasReport: false }] }),
      }),
    );
    expect(out).toContain("↑");
    expect(out).not.toContain("✓");
  });

  it("shows no migration marker on an unmigrated row", async () => {
    const out = await capture(
      React.createElement(Explorer, {
        state: explorerState({ lights: [{ ...light, hasMv3: false, hasReport: false }] }),
      }),
    );
    expect(out).not.toContain("✓");
    expect(out).not.toContain("↑");
  });

  it("renders the focused search bar with the term and cursor", async () => {
    const out = await capture(
      React.createElement(Explorer, { state: explorerState({ search: "sample", searchFocused: true }) }),
    );
    expect(out).toContain("sample█");
    expect(out).toContain("ctrl+u clear");
  });

  it("renders the help overlay with every key group", async () => {
    const out = await capture(React.createElement(HelpView), { rows: 60 });
    expect(out).toContain("keyboard help");
    expect(out).toContain("navigation");
    expect(out).toContain("explorer");
    expect(out).toContain("analyzer");
    expect(out).toContain("migrate all / stop host job");
    expect(out).toContain("record a report");
    expect(out).toContain("list markers");
    expect(out).toContain("a report has been recorded");
  });

  it("renders analyzer tags and breakdown bars", async () => {
    const state = {
      ...analyzerState,
      profile: { ...analyzerState.profile!, tags: ["webpack", "minified"] },
    };
    const out = await capture(React.createElement(Analyzer, { state }));
    expect(out).toContain("tags");
    expect(out).toContain("[webpack]");
    expect(out).toContain("█");
  });

  it("renders analyzer sections and browser rows", async () => {
    const out = await capture(React.createElement(Analyzer, { state: { ...analyzerState, scroll: 0 } }), { rows: 60 });
    expect(out).toContain("breakdown");
    expect(out).toContain("manifest (mv3)");
    expect(out).toContain("jfpmipfmnoleakbnehmhhoefgofjilba");
    expect(out).toContain("Generates deep links for AliExpress");
    expect(out).not.toContain("b launch");
  });

  it("scrolls the analyzer to reveal lower sections", async () => {
    const out = await capture(
      React.createElement(Analyzer, { state: { ...analyzerState, scroll: 1000 } }),
    );
    expect(out).toContain("DeepAli (mv2)");
    expect(out).toContain("listeners");
    expect(out).toContain("chrome.runtime.onMessage");
    expect(out).toContain("mv2 loaded");
    expect(out).toContain("scroll");
  });

  it("renders the status bar with ssh label and hints", async () => {
    const out = await capture(
      React.createElement(StatusBar, {
        message: "boom",
        sshLabel: "myserver",
        tunnel: "up",
        hints: "↑/↓ select · enter open · q quit",
      }),
    );
    expect(out).toContain("boom");
    expect(out).toContain("ssh myserver");
    expect(out).toContain("↑/↓ select · enter open · q quit");
  });
});

describe("error formatting", () => {
  // The exact shape that filled the explorer panel with ~40 lines of JSON when the stub
  // server omitted a required field.
  const zodWall =
    '-32603: ' +
    JSON.stringify(
      [
        { code: "invalid_type", expected: "boolean", received: "undefined", path: ["extensions", 0, "hasReport"], message: "Required" },
        { code: "invalid_type", expected: "boolean", received: "undefined", path: ["extensions", 1, "hasReport"], message: "Required" },
        { code: "invalid_type", expected: "boolean", received: "undefined", path: ["extensions", 2, "hasReport"], message: "Required" },
      ],
      null,
      2,
    );

  it("collapses a zod issue array to one actionable line", () => {
    expect(formatError(zodWall)).toBe("-32603 extensions.0.hasReport: Required (+2 more)");
  });

  it("keeps a plain message intact", () => {
    expect(formatError("not connected")).toBe("not connected");
    expect(formatError("-32601: unknown method")).toBe("-32601 unknown method");
  });

  it("collapses multi-line text to its first meaningful line", () => {
    expect(formatError("boom\n  at stack frame\n  at more")).toBe("boom");
  });

  it("renders an error as one row instead of a wall of JSON", async () => {
    const out = await capture(
      React.createElement(Explorer, { state: explorerState({ lights: [], error: zodWall }) }),
      { columns: 200 },
    );
    expect(out).toContain("hasReport: Required");
    // The raw zod payload must not reach the screen.
    expect(out).not.toContain('"invalid_type"');
    expect(out).not.toContain('"expected"');
    // One row, not forty: no line of the frame may repeat the issue text.
    const errorRows = out.split("\n").filter((l) => l.includes("hasReport"));
    expect(errorRows).toHaveLength(1);
  });
});
