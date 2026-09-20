/**
 * The export is what the review pass is FOR, so the cases that matter are the ones where a
 * careless cell would change the conclusion drawn from it.
 */
import { describe, expect, it } from "vitest";
import type { Report, ReportRow } from "@extlens/protocol";
import { reportsToCsv } from "../src/renderer/lib/export-reports";

const base: Report = {
    id: "r1",
    extensionId: "abc",
    tested: true,
    verificationDurationSecs: 42,
    installs: true,
    worksInMv2: true,
    needsLogin: false,
    isPopupWorking: null,
    isSettingsWorking: null,
    isNewTabWorking: null,
    isInteresting: false,
    overallWorking: null,
    notes: "",
    listeners: [],
    surfaces: [{ surface: "popup", status: "working", note: "" }],
    verdict: "working",
    score: 1,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
};

const rows = (...reports: Report[]): ReportRow[] => reports.map((report) => ({ name: "An Ext", report }));

/**
 * A real CSV reader, because a naive split on commas cannot read the file the code writes — which
 * is the whole point of the escaping tests below.
 */
function parseCsv(csv: string): string[][] {
    const rows: string[][] = [[]];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < csv.length; i++) {
        const c = csv[i];
        if (quoted) {
            if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { rows[rows.length - 1].push(cell); cell = ""; }
        else if (c === "\n") { rows[rows.length - 1].push(cell); cell = ""; rows.push([]); }
        else cell += c;
    }
    rows[rows.length - 1].push(cell);
    return rows;
}

function column(csv: string, header: string, line = 1): string {
    const parsed = parseCsv(csv);
    return parsed[line][parsed[0].indexOf(header)];
}

describe("the shape a spreadsheet needs", () => {
    it("puts one column per surface, so a corpus question is one column to count", () => {
        const csv = reportsToCsv(rows(base));
        expect(csv.split("\n")[0]).toContain("surface_popup");
        expect(csv.split("\n")[0]).toContain("surface_context_menu");
        expect(column(csv, "surface_popup")).toBe("working");
    });

    it("leaves a surface the extension does not have blank, not untested", () => {
        // The question was never asked; counting it as untested would inflate that column.
        expect(column(reportsToCsv(rows(base)), "surface_context_menu")).toBe("");
    });
});

describe("cells that must not lie", () => {
    it("writes an untestable extension's score as empty, never as zero", () => {
        // Zero would read as "everything broken", which is the opposite claim.
        const untestable = { ...base, score: null, verdict: "not_testable" as const };
        expect(column(reportsToCsv(rows(untestable)), "score")).toBe("");
        expect(column(reportsToCsv(rows(untestable)), "verdict")).toBe("not_testable");
    });

    it("keeps a partial score exactly", () => {
        expect(column(reportsToCsv(rows({ ...base, score: 0.5 })), "score")).toBe("0.5");
    });

    it("carries the reviewer's note for the surface it belongs to", () => {
        const withNote = {
            ...base,
            surfaces: [{ surface: "popup" as const, status: "broken" as const, note: "throws on open" }],
        };
        expect(column(reportsToCsv(rows(withNote)), "note_popup")).toBe("throws on open");
    });
});

describe("csv escaping", () => {
    it("quotes a note containing a comma, so the columns do not shift", () => {
        const csv = reportsToCsv(rows({ ...base, notes: "broken, badly" }));
        expect(csv).toContain('"broken, badly"');
        expect(column(csv, "created_at")).toBe("2026-09-14T00:00:00.000Z");
    });

    it("escapes embedded quotes rather than truncating", () => {
        expect(reportsToCsv(rows({ ...base, notes: 'says "hi"' }))).toContain('"says ""hi"""');
    });

    it("survives a note with a newline in it", () => {
        // A bare newline would end the record and turn one report into two malformed ones.
        const csv = reportsToCsv(rows({ ...base, notes: "line one\nline two" }));
        expect(column(csv, "notes")).toBe("line one\nline two");
        expect(column(csv, "created_at")).toBe("2026-09-14T00:00:00.000Z");
    });
});

describe("empty corpus", () => {
    it("still writes the header, so the file is readable rather than blank", () => {
        expect(parseCsv(reportsToCsv([]))).toHaveLength(1);
        expect(reportsToCsv([])).toContain("extension_id");
    });
});
