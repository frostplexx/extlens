/**
 * The corpus list: search, sort, paging, selection.
 *
 * The page size is larger than the terminal client's because a browser can scroll: the table is
 * the whole point of the web UI, so it shows a screenful and then some rather than exactly as
 * many rows as fit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExtensionLight, ListResult, ListStats, SortOrder } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge.js";

export const PAGE_SIZE = 100;

export const SORTS: { value: SortOrder; label: string }[] = [
    { value: "interestingness_desc", label: "score ↓" },
    { value: "interestingness_asc", label: "score ↑" },
    { value: "name", label: "name" },
];

export interface ExtensionsState {
    rows: ExtensionLight[];
    stats: ListStats | null;
    page: number;
    totalPages: number;
    search: string;
    sort: SortOrder;
    loading: boolean;
    error: string | null;
    selectedId: string | null;
    setSearch: (value: string) => void;
    setSort: (value: SortOrder) => void;
    setPage: (value: number) => void;
    select: (id: string | null) => void;
    /** Move the selection by one row, for keyboard navigation. */
    moveSelection: (delta: 1 | -1) => void;
    refresh: () => void;
}

export function useExtensions(bridge: BridgeHandle, connected: boolean): ExtensionsState {
    const [rows, setRows] = useState<ExtensionLight[]>([]);
    const [stats, setStats] = useState<ListStats | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearchRaw] = useState("");
    const [debounced, setDebounced] = useState("");
    const [sort, setSort] = useState<SortOrder>("interestingness_desc");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(search), 250);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (!connected) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        bridge
            .call<ListResult>("extensions.list", {
                page,
                pageSize: PAGE_SIZE,
                search: debounced || undefined,
                sort,
            })
            .then((result) => {
                if (cancelled) return;
                setRows(result.extensions);
                setStats(result.stats);
                setTotalPages(result.totalPages);
                setLoading(false);
            })
            .catch((e: Error) => {
                if (cancelled) return;
                setError(e.message);
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [bridge, connected, page, debounced, sort, nonce]);

    const setSearch = useCallback((value: string) => {
        // A new query invalidates the page number: staying on page 7 of the old result set shows
        // an empty table and looks like "no matches".
        setSearchRaw(value);
        setPage(1);
    }, []);

    const moveSelection = useCallback(
        (delta: 1 | -1) => {
            setSelectedId((current) => {
                if (rows.length === 0) return current;
                const index = rows.findIndex((r) => r.id === current);
                const next = Math.max(0, Math.min(rows.length - 1, index + delta));
                return rows[index < 0 ? 0 : next]?.id ?? current;
            });
        },
        [rows],
    );

    return useMemo(
        () => ({
            rows,
            stats,
            page,
            totalPages,
            search,
            sort,
            loading,
            error,
            selectedId,
            setSearch,
            setSort: (value: SortOrder) => {
                setSort(value);
                setPage(1);
            },
            setPage,
            select: setSelectedId,
            moveSelection,
            refresh: () => setNonce((n) => n + 1),
        }),
        [rows, stats, page, totalPages, search, sort, loading, error, selectedId, setSearch, moveSelection],
    );
}
