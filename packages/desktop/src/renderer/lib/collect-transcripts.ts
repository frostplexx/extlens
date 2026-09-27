/**
 * Pulling every extension's transcript down in one go, for the export.
 *
 * The viewer reads one transcript a page at a time because a reader only ever wants the top of it
 * (see hooks/useTranscript). An export wants the opposite: whole transcripts, all of them, because
 * the thing they are for is a pass over the corpus — hand an agent every failed migration's record
 * and ask what the failures have in common. A transcript cut off halfway would make that pass lie.
 *
 * So this pages each one to the end, sequentially. Sequentially on purpose: the host reads and
 * parses a JSONL file per call, and firing a corpus of those at it at once buys nothing but a
 * chance of starving the migration that may be running alongside.
 */
import type { TranscriptEntry, TranscriptResult, TranscriptSummary } from "@extlens/protocol";

/** The protocol's ceiling. Whole transcripts, so the fewest round trips the host will allow. */
export const EXPORT_PAGE = 500;

/**
 * A page count no real run reaches, as a stop for a host that keeps answering with entries.
 * 500 × 200 is a hundred thousand entries; a long migration is a few thousand.
 */
const MAX_PAGES = 200;

/** Why a row carries no transcript. The distinction is the difference between two conclusions. */
export type TranscriptAbsence =
    /** The host keeps transcripts, but has none for this extension. */
    | "none"
    /** This host records no transcripts at all, so absence says nothing about the migration. */
    | "unsupported"
    /** The host had one and the read failed; see `error`. */
    | "error";

export interface TranscriptExport {
    available: boolean;
    /** Absent when available: the reason there is nothing to read. */
    absence?: TranscriptAbsence;
    /** Entries in the host's transcript — compare with `entries.length` to see a short read. */
    total: number;
    summary: TranscriptSummary | null;
    entries: TranscriptEntry[];
    error?: string;
}

/** A host that does not implement the method answers -32601; the SDK words it, we recognise it. */
export function isUnsupported(message: string): boolean {
    return /method not found|no agent transcripts|-32601/i.test(message);
}

type Call = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

const EMPTY = (absence: TranscriptAbsence, error?: string): TranscriptExport => ({
    available: false,
    absence,
    total: 0,
    summary: null,
    entries: [],
    ...(error === undefined ? {} : { error }),
});

/** One extension's whole transcript. Never throws: a failed read is a field, not a lost export. */
export async function fetchTranscript(call: Call, extensionId: string): Promise<TranscriptExport> {
    const entries: TranscriptEntry[] = [];
    let summary: TranscriptSummary | null = null;
    let total = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
        let result: TranscriptResult;
        try {
            result = await call<TranscriptResult>("transcript.get", {
                extensionId,
                offset: entries.length,
                limit: EXPORT_PAGE,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            // Nothing read at all and the host does not do transcripts: not a failure to report.
            if (entries.length === 0 && isUnsupported(message)) return EMPTY("unsupported");
            if (entries.length === 0) return EMPTY("error", message);
            // A later page failed. Keep what arrived, and say it is short.
            return { available: true, total, summary, entries, error: message };
        }
        if (!result.available) return EMPTY("none");
        // The summary is the host's, computed over the whole transcript, so the first page's is
        // already right; a later page's would be the same.
        summary ??= result.summary;
        total = result.total;
        // An empty page ends the read even when `total` disagrees — a transcript that grew or
        // shrank between pages must not spin here.
        if (result.entries.length === 0) break;
        const seen = new Set(entries.map((e) => e.index));
        for (const entry of result.entries) if (!seen.has(entry.index)) entries.push(entry);
        if (entries.length >= total) break;
    }

    return { available: true, total, summary, entries };
}

/**
 * Every extension's transcript, keyed by id.
 *
 * `onProgress` is called per extension because this is the slow part of an export by a wide margin
 * — a corpus is hundreds of files of hundreds of kilobytes — and an export that looks hung is one
 * the user cancels halfway.
 */
export async function collectTranscripts(
    call: Call,
    extensionIds: string[],
    onProgress?: (done: number, totalIds: number) => void,
): Promise<Record<string, TranscriptExport>> {
    const byId: Record<string, TranscriptExport> = {};
    let done = 0;
    for (const id of extensionIds) {
        byId[id] = await fetchTranscript(call, id);
        onProgress?.(++done, extensionIds.length);
        // One "this host keeps none" answer settles it for the corpus; asking the other 199 times
        // is a round trip each for an answer we already have.
        if (byId[id].absence === "unsupported") {
            for (const rest of extensionIds.slice(done)) byId[rest] = EMPTY("unsupported");
            onProgress?.(extensionIds.length, extensionIds.length);
            break;
        }
    }
    return byId;
}
