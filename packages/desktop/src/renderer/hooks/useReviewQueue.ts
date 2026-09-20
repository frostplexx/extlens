/**
 * The review queue: the corpus as a sequence to work through, rather than a page to browse.
 *
 * A review pass is one extension after another, so the queue owns its own fetching and paging and
 * is deliberately independent of the browse table — entering and leaving review must not disturb
 * where the table was, and the queue must be able to run past the end of a page without the
 * reviewer noticing there was one.
 *
 * The queue is a snapshot taken when the pass starts. An extension reviewed mid-pass keeps its
 * place instead of vanishing from under the cursor, which is what would happen if "untested" were
 * re-evaluated against live data on every save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionLight, ListResult, SortOrder } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";

/** The protocol caps a page at 200 rows; ask for the most a single call can carry. */
const FETCH_SIZE = 200;

/** Fetch the next page once the cursor is this close to the end of what we hold. */
const PREFETCH_MARGIN = 5;

export type QueueFilter = "untested" | "mv3" | "all";

export const QUEUE_FILTERS: { value: QueueFilter; label: string; describe: string }[] = [
    { value: "untested", label: "Not yet reviewed", describe: "extensions with no report" },
    { value: "mv3", label: "Migrated, not reviewed", describe: "has an MV3 build and no report" },
    { value: "all", label: "Everything", describe: "the whole corpus, in order" },
];

/** Does this extension belong in a pass with the given filter? Exported for testing. */
export function matchesFilter(filter: QueueFilter, row: ExtensionLight): boolean {
    if (filter === "all") return true;
    if (filter === "mv3") return row.hasMv3 && !row.hasReport;
    return !row.hasReport;
}

/**
 * Append a freshly fetched page to the queue, keeping it a stable sequence.
 *
 * Two rules, both about not moving the ground under the cursor: an id already queued is never
 * added twice (pages can overlap when the host's ordering shifts between calls, and a duplicate
 * would make the reviewer judge the same extension twice), and filtering happens on the way in,
 * so an extension reviewed mid-pass keeps its place rather than vanishing.
 */
export function appendPage(
    existing: ExtensionLight[],
    incoming: ExtensionLight[],
    filter: QueueFilter,
): ExtensionLight[] {
    const seen = new Set(existing.map((r) => r.id));
    return [...existing, ...incoming.filter((r) => !seen.has(r.id) && matchesFilter(filter, r))];
}

export interface ReviewQueue {
    /** The extension being reviewed, or null when the queue is empty or exhausted. */
    current: ExtensionLight | null;
    /** 1-based position for display; 0 when empty. */
    position: number;
    /** How many are queued so far. `moreToLoad` says whether that is the final answer. */
    length: number;
    moreToLoad: boolean;
    /** Ids the reviewer has filed a report for during this pass. */
    reviewed: Set<string>;
    loading: boolean;
    error: string | null;
    filter: QueueFilter;
    setFilter: (filter: QueueFilter) => void;
    next: () => void;
    previous: () => void;
    /** Mark the current one reviewed and move on. */
    completeCurrent: () => void;
    hasNext: boolean;
    hasPrevious: boolean;
}

export function useReviewQueue(
    bridge: BridgeHandle,
    connected: boolean,
    sort: SortOrder,
    active: boolean,
): ReviewQueue {
    const [filter, setFilterRaw] = useState<QueueFilter>("untested");
    const [rows, setRows] = useState<ExtensionLight[]>([]);
    const [index, setIndex] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
    // Guards against two fetches for the same page when the cursor moves while one is in flight.
    const fetching = useRef(false);

    const reset = useCallback(() => {
        setRows([]);
        setIndex(0);
        setPage(1);
        setTotalPages(1);
        setError(null);
    }, []);

    const setFilter = useCallback(
        (next: QueueFilter) => {
            setFilterRaw(next);
            reset();
        },
        [reset],
    );

    // A pass is scoped to the sort order it started with; changing it restarts the queue rather
    // than reordering the ground under the cursor.
    useEffect(() => {
        if (active) reset();
    }, [sort, active, reset]);

    useEffect(() => {
        if (!active || !connected || fetching.current) return;
        // Stop once the cursor is comfortably inside what we hold and there is nothing more.
        const needMore = rows.length - index <= PREFETCH_MARGIN;
        if (!needMore || (page > totalPages && rows.length > 0)) return;

        fetching.current = true;
        setLoading(true);
        bridge
            .call<ListResult>("extensions.list", { page, pageSize: FETCH_SIZE, sort })
            .then((result) => {
                setRows((prev) => appendPage(prev, result.extensions, filter));
                setTotalPages(result.totalPages);
                setPage((p) => p + 1);
                setLoading(false);
                setError(null);
            })
            .catch((e: Error) => {
                setError(e.message);
                setLoading(false);
            })
            .finally(() => {
                fetching.current = false;
            });
    }, [bridge, active, connected, rows.length, index, page, totalPages, sort, filter]);

    const current = rows[index] ?? null;
    const moreToLoad = page <= totalPages;

    const next = useCallback(() => setIndex((i) => Math.min(i + 1, Math.max(0, rows.length))), [rows.length]);
    const previous = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

    const completeCurrent = useCallback(() => {
        setReviewed((prev) => {
            if (!current) return prev;
            const copy = new Set(prev);
            copy.add(current.id);
            return copy;
        });
        next();
    }, [current, next]);

    return useMemo(
        () => ({
            current,
            position: rows.length === 0 ? 0 : Math.min(index + 1, rows.length),
            length: rows.length,
            moreToLoad,
            reviewed,
            loading,
            error,
            filter,
            setFilter,
            next,
            previous,
            completeCurrent,
            hasNext: index < rows.length - 1 || moreToLoad,
            hasPrevious: index > 0,
        }),
        [current, rows.length, index, moreToLoad, reviewed, loading, error, filter, setFilter, next, previous, completeCurrent],
    );
}
