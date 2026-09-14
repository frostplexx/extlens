/**
 * The frame must not change height as the list contents change.
 *
 * A half-filled last page, an empty search result and an error state all have fewer rows than a
 * full page. When the frame shrinks to match, ink leaves the previous frame's lower rows painted
 * on the terminal, so the UI appears to sprout stale duplicate content. fits-terminal.test.ts
 * checks the frame is never too TALL; this checks it is always the SAME height.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { Box } from "ink";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { Explorer } from "../src/components/explorer.js";
import { StatusBar } from "../src/components/status-bar.js";
import { TopBar } from "../src/components/ui.js";
import { listPageSize, isCompact } from "../src/layout.js";

async function paint(node: React.ReactElement, columns: number, rows: number): Promise<string[]> {
  const stdout = new PassThrough() as any;
  stdout.columns = columns; stdout.rows = rows;
  let out = ""; stdout.on("data", (c: Buffer) => (out += c.toString()));
  const inst = render(node, { stdout } as never);
  await new Promise((r) => setTimeout(r, 90));
  inst.unmount();
  return out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n");
}

const names = ["uBlock Origin", "A very long extension name that will certainly not fit in the pane", "x", "Tab Addict"];
const light = (i: number) => ({
  id: `abcdefghijklmnop${i}`, name: names[i % names.length], version: "1.2.3",
  manifestVersion: ((i % 2) + 2) as 2 | 3, score: (i * 7) % 100,
  tags: i % 3 === 0 ? ["webpack", "minified", "react", "analytics"] : [],
  hasMv3: i % 2 === 0, hasReport: i % 4 === 0,
});
const state = (n: number, sel = 0) => ({
  lights: Array.from({ length: n }, (_, i) => light(i)),
  stats: { total: 40, analyzed: 40, withMv3: 12, avgScore: 63.2 },
  search: "", searchFocused: false, selectedIndex: sel, loading: false, error: null,
  page: 2, totalPages: 4, sort: "interestingness_desc",
}) as never;

describe("whole-frame height stability", () => {
  // Wide and narrow, tall and short: the narrow cases matter because that is where a long name
  // or a tag list would wrap and grow a row if the panels were padded rather than fixed.
  it.each([[30, 120], [24, 100], [40, 80], [20, 60]])("at %i rows x %i cols", async (rows, cols) => {
    const ps = listPageSize(rows);
    const compact = isCompact(rows);
    const frame = (n: number, sel: number) =>
      React.createElement(Box, { flexDirection: "column" },
        React.createElement(TopBar, { status: "connected", scope: "explorer", key: "t" }),
        React.createElement(Explorer, { state: state(n, sel), pageSize: ps, compact, key: "e" }),
        React.createElement(StatusBar, { message: null, hints: "q quit", compact, key: "s" }),
      );
    const heights: Record<string, number> = {};
    for (const [label, n, sel] of [["full", ps, 3], ["half", Math.max(1, Math.floor(ps / 2)), 1], ["one", 1, 0], ["empty", 0, 0]] as const) {
      const lines = await paint(frame(n, sel), cols, rows);
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      heights[label] = lines.length;
    }
    expect(new Set(Object.values(heights)).size, `heights differed: ${JSON.stringify(heights)}`).toBe(1);
  });
});
