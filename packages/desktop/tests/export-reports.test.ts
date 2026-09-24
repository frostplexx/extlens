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

const analysis = {
    findingCount: 3,
    signalCount: 7,
    signalsByCategory: { blocking_webrequest: 5, background_dom: 2 },
    filesAffected: 4,
};
const agentUsage = { skillsRead: ["mv3-non-trivial", "manifest-csp"], toolCalls: { read: 9, edit: 4 }, toolCallCount: 13 };

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

describe("difficulty, so a score can be read at all", () => {
    it("carries the counts that say how much there was to get wrong", () => {
        // Two extensions at score 1.0 are the same cell until this column separates them.
        const csv = reportsToCsv([{ name: "An Ext", report: base, analysis }]);
        expect(column(csv, "finding_count")).toBe("3");
        expect(column(csv, "signal_count")).toBe("7");
        expect(column(csv, "files_affected")).toBe("4");
    });

    it("gives each signal category its own column, discovered from the rows", () => {
        // The host owns the vocabulary; hardcoding it here would silently drop a new category.
        const csv = reportsToCsv([{ name: "An Ext", report: base, analysis }]);
        expect(csv.split("\n")[0]).toContain("signal_blocking_webrequest");
        expect(column(csv, "signal_blocking_webrequest")).toBe("5");
        expect(column(csv, "signal_background_dom")).toBe("2");
    });

    it("leaves difficulty blank when the run is gone, never zero", () => {
        // Zero would claim the extension needed no work, which is a different and false finding.
        const csv = reportsToCsv([
            { name: "Measured", report: base, analysis },
            { name: "Review only", report: base },
        ]);
        expect(column(csv, "signal_count", 2)).toBe("");
        expect(column(csv, "signal_blocking_webrequest", 2)).toBe("");
    });

    it("keeps the narrow shape when no row was analysed", () => {
        // A host that does no static analysis should not gain a wall of empty columns.
        const header = reportsToCsv(rows(base)).split("\n")[0];
        expect(header).not.toContain("signal_count");
        expect(header).not.toContain("skills_read");
    });
});

describe("what the agent actually read", () => {
    it("records the reference documents it opened", () => {
        const csv = reportsToCsv([{ name: "An Ext", report: base, agentUsage }]);
        expect(column(csv, "skills_read")).toBe("mv3-non-trivial;manifest-csp");
        expect(column(csv, "skills_read_count")).toBe("2");
        expect(column(csv, "tool_calls")).toBe("13");
    });

    it("distinguishes an agent that opened nothing from one that was never measured", () => {
        // This is the whole point of the column: "read no instructions" is a finding about the
        // model, "not recorded" is a fact about the harness, and they must not share a cell.
        const csv = reportsToCsv([
            { name: "Read nothing", report: base, agentUsage: { skillsRead: [], toolCalls: {}, toolCallCount: 0 } },
            { name: "Not measured", report: base },
        ]);
        expect(column(csv, "skills_read_count", 1)).toBe("0");
        expect(column(csv, "skills_read_count", 2)).toBe("");
    });
});
