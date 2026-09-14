/**
 * Every view must render a frame no taller than the terminal. The client had several
 * independent height calculations, each with a generous Math.max() floor, and every one of
 * them produced a frame taller than a short terminal — so the top of the UI scrolled away.
 * These tests measure the real rendered height instead of trusting the arithmetic.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { Explorer } from "../src/components/explorer.js";
import { ReportForm, buildReportRows } from "../src/components/report-form.js";
import { LogView } from "../src/components/log.js";
import { HelpView } from "../src/components/help.js";
import { CHROME, contentRows, isCompact, listPageSize, MIN_ROWS } from "../src/layout.js";

/**
 * Render at a fixed terminal size and return the painted frame height.
 *
 * A TTY-like stdin is required: components that call useInput otherwise make ink paint a
 * multi-line "Raw mode is not supported" error box into the same stream, which would be
 * counted as UI.
 */
async function frameHeight(node: React.ReactElement, columns: number, rows: number): Promise<number> {
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
  stdout.columns = columns;
  stdout.rows = rows;
  const stdin = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  let out = "";
  stdout.on("data", (c: Buffer) => (out += c.toString()));
  const inst = render(node, { stdout, stdin, exitOnCtrlC: false } as never);
  await new Promise((r) => setTimeout(r, 90));
  inst.unmount();
  const lines = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  // Any ink error box would be counted as UI height and silently pass/fail the assertion
  // for the wrong reason.
  if (/\bERROR\b/.test(out)) throw new Error(`ink error overlay polluted the frame:\n${out.slice(0, 400)}`);
  return lines.length;
}

const light = {
  id: "x", name: "an-extension", version: "1.0", manifestVersion: 2 as const,
  score: 10, tags: [], hasMv3: false, hasReport: false,
};
const explorerState = {
  lights: [light, { ...light, id: "y" }], stats: { total: 2, analyzed: 2, withMv3: 0, avgScore: 10 },
  search: "", searchFocused: false, selectedIndex: 0, loading: false, error: null,
  page: 1, totalPages: 1, sort: "interestingness_desc",
} as never;

const HEIGHTS = [MIN_ROWS, 15, 16, 18, 20, 24, 30, 40];

describe("views fit the terminal", () => {
  // The explorer renders inside the app's chrome: the top bar plus the status bar, and the
  // status bar's spacer row unless the terminal is too short for it. Derived from layout.ts so
  // this test cannot drift from the budget the components actually use.
  const appChrome = (rows: number) =>
    CHROME.topBar + CHROME.statusBar + (isCompact(rows) ? 0 : 1);

  it.each(HEIGHTS)("explorer at %i rows", async (rows) => {
    const h = await frameHeight(
      React.createElement(Explorer, {
        state: explorerState,
        pageSize: listPageSize(rows),
        compact: isCompact(rows),
      }),
      100,
      rows,
    );
    expect(h).toBeLessThanOrEqual(rows - appChrome(rows));
  });

  it.each(HEIGHTS)("log view at %i rows", async (rows) => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      seq: i, ts: "t", stream: "stdout" as const, text: `line ${i}`,
    }));
    const h = await frameHeight(
      React.createElement(LogView, { status: null, lines, error: null, height: contentRows(rows) }),
      100,
      rows,
    );
    expect(h).toBeLessThanOrEqual(rows - appChrome(rows));
  });

  it.each(HEIGHTS)("help overlay at %i rows", async (rows) => {
    const h = await frameHeight(React.createElement(HelpView, { height: contentRows(rows) }), 100, rows);
    expect(h).toBeLessThanOrEqual(rows - appChrome(rows));
  });

  it.each(HEIGHTS)("report form with many listeners at %i rows", async (rows) => {
    const listenerCount = 30;
    const formRows = buildReportRows({
      listenerCount, hasPopup: true, hasSettings: true, isNewTab: true,
    });
    const form = {
      cursor: 0, listenerStatus: {}, installs: true, worksInMv2: true, needsLogin: false,
      isPopupWorking: true, isSettingsWorking: true, isNewTabWorking: true,
      isInteresting: true, overallWorking: "yes", notes: "", notesFocused: false,
      saving: false, savedId: null, error: null, verificationStart: Date.now(),
    } as never;
    const h = await frameHeight(
      React.createElement(ReportForm, {
        form, rows: formRows,
        auto: { name: "x", mv2Id: "a", mv3Id: "b", elapsedSecs: 1 },
        onCycle: () => {}, onMove: () => {}, onToggleNotes: () => {},
        onNotesChange: () => {}, onSubmit: () => {}, onCancel: () => {},
        listenerApis: Array.from({ length: listenerCount }, (_, i) => ({ api: `api${i}`, file: "f.js" })),
      } as never),
      100,
      rows,
    );
    expect(h).toBeLessThanOrEqual(rows - appChrome(rows));
  });
});
