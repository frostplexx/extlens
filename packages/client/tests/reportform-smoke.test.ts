import { describe, it, expect } from "vitest";
import { render } from "ink";
import { PassThrough } from "node:stream";
import React from "react";
import { ReportForm, buildReportRows } from "../src/components/report-form.js";
import type { ReportDraftForm } from "../src/types.js";

async function capture(node: React.ReactElement): Promise<string> {
  const stdout = new PassThrough();
  Object.assign(stdout, { rows: 60, columns: 100 });
  let out = "";
  stdout.on("data", (c: Buffer) => (out += c.toString()));
  const instance = render(node, { stdout, stdin: new PassThrough() } as never);
  await new Promise((r) => setTimeout(r, 80));
  instance.unmount();
  return out.replace(/\u001b\[[0-9;]*m/g, "");
}

const form: ReportDraftForm = {
  installs: true,
  worksInMv2: true,
  needsLogin: false,
  isPopupWorking: true,
  isSettingsWorking: true,
  isNewTabWorking: true,
  isInteresting: false,
  overallWorking: "yes",
  notes: "",
  listenerStatus: ["untested", "yes"],
  cursor: 0,
  notesFocused: false,
  saving: false,
  savedId: null,
  error: null,
  verificationStart: Date.now(),
};

describe("report form", () => {
  it("renders ExtPorter fields in order", async () => {
    const rows = buildReportRows({ hasPopup: true, hasSettings: true, isNewTab: true, listenerCount: 2 });
    const out = await capture(
      React.createElement(ReportForm, {
        form,
        rows,
        auto: { name: "Example", mv2Id: "mv2-id", mv3Id: "mv3-id", elapsedSecs: 1.5 },
        onCycle: () => {}, onMove: () => {}, onToggleNotes: () => {}, onNotesChange: () => {},
        onSubmit: () => {}, onCancel: () => {},
        listenerApis: [
          { api: "chrome.tabs.onUpdated", file: "bg.js" },
          { api: "chrome.runtime.onMessage", file: "bg.js" },
        ],
      }),
    );
    expect(out).toContain("Extension: Example");
    expect(out).toContain("MV2 ID: mv2-id");
    expect(out).toContain("MV3 ID: mv3-id");
    expect(out).toContain("Installs");
    expect(out).toContain("Works in MV2");
    expect(out).toContain("Needs Login");
    expect(out).toContain("Is Popup Working");
    expect(out).toContain("Is Settings Working");
    expect(out).toContain("Is New Tab Working");
    expect(out).toContain("Is Interesting");
    expect(out).toContain("Overall Working");
    expect(out).toContain("Notes (optional)");
    expect(out).toContain("Submit");
    expect(out).toContain("works");
    expect(out).not.toContain("errors seen");
    expect(out).not.toContain("seems slower");
  });

  it("hides conditional rows when the manifest lacks them", async () => {
    const rows = buildReportRows({ hasPopup: false, hasSettings: false, isNewTab: false, listenerCount: 0 });
    const out = await capture(
      React.createElement(ReportForm, {
        form: { ...form, listenerStatus: [] },
        rows,
        auto: { name: "X", mv2Id: null, mv3Id: null, elapsedSecs: null },
        onCycle: () => {}, onMove: () => {}, onToggleNotes: () => {}, onNotesChange: () => {},
        onSubmit: () => {}, onCancel: () => {},
        listenerApis: [],
      }),
    );
    expect(out).toContain("Installs");
    expect(out).not.toContain("Is Popup Working");
    expect(out).not.toContain("Is Settings Working");
    expect(out).not.toContain("Is New Tab Working");
    expect(out).toContain("Overall Working");
  });
});
