/**
 * Turning stored reports into something that can leave the tool.
 *
 * The whole point of a review pass is the table it produces — "of 200 extensions with a custom new
 * tab, 120 work" — and that table gets built in a spreadsheet or a notebook, not here. So the
 * export is wide: one row per extension, one column per surface, because that is the shape those
 * questions are asked in. JSON is offered alongside for anything the columns flatten away (notes,
 * timings, the legacy fields) and for the one thing no table can hold: the agent's transcript of
 * each migration, attached to the row it belongs to, so a later pass over the failures can read
 * what actually happened in each one.
 */
import type { ReportRow, UiSurface } from "@extlens/protocol";
import { UI_SURFACES } from "@extlens/analyzer/surfaces";
import type { TranscriptExport } from "./collect-transcripts";

/** Quoted only when it has to be, so the common case stays readable in a diff. */
function csvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Signal categories are the host's vocabulary, not ours, so they are discovered from the rows
 * rather than hardcoded: a host that grows a category gets a column without a change here, and a
 * host that does no static analysis gets none. Sorted, so two exports of one corpus diff cleanly.
 */
function signalCategories(rows: ReportRow[]): string[] {
    const keys = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row.analysis?.signalsByCategory ?? {})) keys.add(key);
    return [...keys].sort();
}

export function reportsToCsv(rows: ReportRow[]): string {
    const surfaces = UI_SURFACES as readonly UiSurface[];
    const categories = signalCategories(rows);
    // Columns appear only when some row has the data. A host that does no static analysis, or an
    // export of reviews whose runs are gone, keeps the narrow shape it had before.
    const hasAnalysis = rows.some((r) => r.analysis);
    const hasUsage = rows.some((r) => r.agentUsage);
    const header = [
        "extension_id",
        "name",
        "verdict",
        "score",
        "installs",
        "worked_in_mv2",
        "needs_account",
        "interesting",
        ...surfaces.map((s) => `surface_${s}`),
        // Notes are where a reviewer says what the statuses cannot, so they travel with the row.
        ...surfaces.map((s) => `note_${s}`),
        "notes",
        // How much there was to get wrong. A score column with no difficulty column beside it
        // cannot tell "preserved everything on a hard extension" from "was handed nothing to do",
        // and in a model comparison that distinction is the whole question.
        ...(hasAnalysis ? ["finding_count", "signal_count", "files_affected"] : []),
        ...categories.map((c) => `signal_${c}`),
        // What the agent consumed, not what it was offered. An empty skills_read on a weak row is
        // the difference between a model that cannot migrate and one that never opened the manual.
        ...(hasUsage ? ["skills_read", "skills_read_count", "tool_calls"] : []),
        "verification_seconds",
        "created_at",
        "updated_at",
    ];

    const lines = [header.join(",")];
    for (const { name, report, analysis, agentUsage } of rows) {
        // Defensive: the host normalises old reports, but an export that throws loses the whole
        // corpus to one malformed row, which is a bad trade for one `?? []`.
        const bySurface = new Map((report.surfaces ?? []).map((s) => [s.surface, s]));
        lines.push(
            [
                report.extensionId,
                name,
                report.verdict ?? "",
                // An empty score is "nothing was testable", which is not zero and must not become 0.
                report.score ?? "",
                report.installs,
                report.worksInMv2,
                report.needsLogin,
                report.isInteresting,
                // A surface the extension does not have is blank, not "untested": the question was
                // never asked, and a spreadsheet counting "untested" should not count it.
                ...surfaces.map((s) => bySurface.get(s)?.status ?? ""),
                ...surfaces.map((s) => bySurface.get(s)?.note ?? ""),
                report.notes,
                // Blank, not 0, when the run's measurements are gone: "not measured" is not "none",
                // and a zero here would read as "this extension needed no work".
                ...(hasAnalysis
                    ? [analysis?.findingCount ?? "", analysis?.signalCount ?? "", analysis?.filesAffected ?? ""]
                    : []),
                ...categories.map((c) => analysis?.signalsByCategory?.[c] ?? ""),
                ...(hasUsage
                    ? [
                          (agentUsage?.skillsRead ?? []).join(";"),
                          agentUsage ? (agentUsage.skillsRead ?? []).length : "",
                          agentUsage?.toolCallCount ?? "",
                      ]
                    : []),
                report.verificationDurationSecs ?? "",
                report.createdAt,
                report.updatedAt,
            ]
                .map(csvCell)
                .join(","),
        );
    }
    return lines.join("\n");
}

/**
 * The JSON export, with each extension's agent transcript attached to its own row.
 *
 * Attached per row rather than kept in a sibling map: the whole reason to export transcripts is to
 * read them against their outcome — "here are the failures, what do they have in common" — and a
 * consumer that has to join two collections by id can get that join wrong. This one cannot.
 *
 * A row's `transcript` is null only when no transcripts were collected at all. Otherwise it is
 * always an object, and `available`/`absence` say why it may be empty: a host that keeps no
 * transcripts is a different fact from a migration that recorded nothing, and an axial pass over
 * "the runs with no record" must not mix the two.
 */
export function reportsToJson(rows: ReportRow[], transcripts?: Record<string, TranscriptExport>): string {
    const reports = transcripts
        ? rows.map((row) => ({
              ...row,
              transcript: transcripts[row.report.extensionId] ?? { available: false, absence: "none", total: 0, summary: null, entries: [] },
          }))
        : rows;
    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            count: rows.length,
            // Stated rather than inferred from the rows: "0 transcripts" and "transcripts were not
            // collected" look identical from the data and mean opposite things.
            transcriptsIncluded: transcripts !== undefined,
            reports,
        },
        null,
        2,
    );
}

/** `extlens-reports-2026-09-14.csv` — dated, because exports accumulate. */
export function exportFilename(extension: "csv" | "json"): string {
    return `extlens-reports-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
