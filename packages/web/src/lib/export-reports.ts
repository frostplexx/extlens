/**
 * Turning stored reports into something that can leave the tool.
 *
 * The whole point of a review pass is the table it produces — "of 200 extensions with a custom new
 * tab, 120 work" — and that table gets built in a spreadsheet or a notebook, not here. So the
 * export is wide: one row per extension, one column per surface, because that is the shape those
 * questions are asked in. JSON is offered alongside for anything the columns flatten away (notes,
 * timings, the legacy fields).
 */
import type { ReportRow, UiSurface } from "@extlens/protocol";
import { UI_SURFACES } from "@extlens/analyzer/surfaces";

/** Quoted only when it has to be, so the common case stays readable in a diff. */
function csvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportsToCsv(rows: ReportRow[]): string {
    const surfaces = UI_SURFACES as readonly UiSurface[];
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
        "verification_seconds",
        "created_at",
        "updated_at",
    ];

    const lines = [header.join(",")];
    for (const { name, report } of rows) {
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

export function reportsToJson(rows: ReportRow[]): string {
    return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, reports: rows }, null, 2);
}

/** Hand the file to the browser. Same-origin blob, so no server round trip. */
export function download(filename: string, content: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    // Revoking immediately can cancel the download in some browsers; a tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `extlens-reports-2026-09-14.csv` — dated, because exports accumulate. */
export function exportFilename(extension: "csv" | "json"): string {
    return `extlens-reports-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
