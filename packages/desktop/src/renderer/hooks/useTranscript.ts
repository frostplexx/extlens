/**
 * One extension's agent transcript, fetched a page at a time.
 *
 * Paged rather than loaded whole because a transcript is the largest thing a host serves — a long
 * run is thousands of entries carrying whole files — and the answer a reader usually wants is at
 * the top: which model, what it cost, where it went wrong. So the first page arrives quickly and
 * the rest is pulled in as it is asked for.
 *
 * Pages accumulate into one list rather than replacing it: the view is a conversation, and a
 * reader scrolling through it must never have the part they already read swapped out.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranscriptEntry, TranscriptResult, TranscriptSummary } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";

/** Entries per request. The protocol's ceiling is 500; this keeps the first paint quick. */
export const TRANSCRIPT_PAGE = 200;

export interface TranscriptState {
    entries: TranscriptEntry[];
    summary: TranscriptSummary | null;
    /** The host kept a transcript for this extension. False is a fact, not a failure. */
    available: boolean;
    /** This host keeps no transcripts at all — a different thing from having none for this one. */
    unsupported: boolean;
    total: number;
    /** Which extension `entries` belong to; see useProfile for why this is not the requested id. */
    loadedId: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => void;
    reload: () => void;
}

/** A host that does not implement the method answers -32601; the SDK words it, we recognise it. */
function isUnsupported(message: string): boolean {
    return /method not found|no agent transcripts|-32601/i.test(message);
}

export function useTranscript(
    bridge: BridgeHandle,
    id: string | null,
    connected: boolean,
    /** Only fetch while the tab is actually open: a transcript is far too big to prefetch. */
    active: boolean,
): TranscriptState {
    const [entries, setEntries] = useState<TranscriptEntry[]>([]);
    const [summary, setSummary] = useState<TranscriptSummary | null>(null);
    const [available, setAvailable] = useState(false);
    const [unsupported, setUnsupported] = useState(false);
    const [total, setTotal] = useState(0);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!id || !connected || !active) return;
        let cancelled = false;
        setLoadedId(null);
        setEntries([]);
        setSummary(null);
        setTotal(0);
        setAvailable(false);
        setUnsupported(false);
        setLoading(true);
        setError(null);
        bridge
            .call<TranscriptResult>("transcript.get", { extensionId: id, offset: 0, limit: TRANSCRIPT_PAGE })
            .then((result) => {
                if (cancelled) return;
                setEntries(result.entries);
                setSummary(result.summary);
                setAvailable(result.available);
                setTotal(result.total);
                setLoadedId(id);
                setLoading(false);
            })
            .catch((e: Error) => {
                if (cancelled) return;
                // Not an error to show in red: the host simply does not do this. The view says so.
                if (isUnsupported(e.message)) setUnsupported(true);
                else setError(e.message);
                setLoadedId(id);
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [bridge, id, connected, active, nonce]);

    const loadMore = useCallback(() => {
        if (!id || loadingMore || entries.length >= total) return;
        setLoadingMore(true);
        bridge
            .call<TranscriptResult>("transcript.get", {
                extensionId: id,
                offset: entries.length,
                limit: TRANSCRIPT_PAGE,
            })
            .then((result) => {
                setEntries((current) => {
                    // The id can change while a page is in flight; appending then would splice one
                    // extension's conversation into another's.
                    if (id !== loadedId) return current;
                    const seen = new Set(current.map((e) => e.index));
                    return [...current, ...result.entries.filter((e) => !seen.has(e.index))];
                });
                setTotal(result.total);
                setLoadingMore(false);
            })
            .catch((e: Error) => {
                setError(e.message);
                setLoadingMore(false);
            });
    }, [bridge, id, entries.length, total, loadingMore, loadedId]);

    return useMemo(
        () => ({
            entries,
            summary,
            available,
            unsupported,
            total,
            loadedId,
            loading,
            loadingMore,
            error,
            hasMore: entries.length < total,
            loadMore,
            reload: () => setNonce((n) => n + 1),
        }),
        [entries, summary, available, unsupported, total, loadedId, loading, loadingMore, error, loadMore],
    );
}
