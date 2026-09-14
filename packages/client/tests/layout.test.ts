/**
 * The vertical budget. A frame one row taller than the terminal permanently scrolls its own
 * header away, so these assertions are about a real failure mode rather than arithmetic taste.
 */
import { describe, expect, it } from "vitest";
import { CHROME, CHROME_ROWS, CHROME_ROWS_COMPACT, contentRows, isCompact, listPageSize, MIN_ROWS, splitPanes } from "../src/layout.js";

describe("row budget", () => {
  it("derives the chrome total from its itemised parts", () => {
    const fixed = CHROME.topBar + CHROME.stats + CHROME.search + CHROME.listFrame + CHROME.statusBar;
    expect(CHROME_ROWS_COMPACT).toBe(fixed);
    expect(CHROME_ROWS).toBe(fixed + CHROME.spacers);
  });

  it("never lets chrome plus list exceed the terminal", () => {
    for (let rows = MIN_ROWS; rows <= 60; rows++) {
      const chrome = isCompact(rows) ? CHROME_ROWS_COMPACT : CHROME_ROWS;
      expect(chrome + listPageSize(rows)).toBeLessThanOrEqual(rows);
    }
  });

  it("keeps at least one list row at any size, including absurd ones", () => {
    for (const rows of [0, 1, 5, 10, MIN_ROWS]) {
      expect(listPageSize(rows)).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps the page size so one keypress cannot redraw an enormous list", () => {
    expect(listPageSize(500)).toBe(40);
  });

  it("leaves scrolling views room for the top and status bars", () => {
    for (const rows of [MIN_ROWS, 24, 40]) {
      expect(contentRows(rows)).toBeLessThanOrEqual(rows - CHROME.topBar - CHROME.statusBar);
      expect(contentRows(rows)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("pane split", () => {
  it("divides the width without overflowing it", () => {
    for (const cols of [60, 80, 100, 200]) {
      const { list, details } = splitPanes(cols);
      expect(list + details + 1).toBeLessThanOrEqual(cols);
    }
  });

  it("keeps both panes legible when the width allows it", () => {
    const { list, details } = splitPanes(120);
    expect(list).toBeGreaterThanOrEqual(30);
    expect(details).toBeGreaterThanOrEqual(30);
  });

  it("splits evenly instead of overflowing when the width is too narrow for two full panes", () => {
    // Regression: a 30-column floor on each pane claimed 61 columns of a 60-column terminal,
    // and ink wrapped the details pane under the list.
    const { list, details } = splitPanes(60);
    expect(list + details + 1).toBeLessThanOrEqual(60);
    expect(Math.abs(list - details)).toBeLessThanOrEqual(1);
  });
});
