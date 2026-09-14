/**
 * The explorer's list: paging, debounced search, sort, and selection.
 *
 * Fetching is keyed on (page, search, sort, connection, refreshKey). The connection is part of
 * that key on purpose: without it, a connect that lands after the first (failed) fetch would
 * leave the list permanently empty.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExtensionLight, ListResult, SortOrder } from "@extlens/protocol";
import type { ExtlensClient } from "@extlens/session";
import type { ConnectionStatus, ExplorerState } from "../types.js";

export const SORTS: SortOrder[] = ["interestingness_desc", "interestingness_asc", "name"];

/** Type-ahead is immediate on screen but only queries the host once input settles. */
const SEARCH_DEBOUNCE_MS = 300;

export interface ExtensionList {
    state: ExplorerState;
    selected: ExtensionLight | null;
    move: (delta: 1 | -1) => void;
    jump: (to: "top" | "bottom") => void;
    setPage: (delta: 1 | -1) => void;
    cycleSort: () => void;
    focusSearch: (focused: boolean) => void;
    typeSearch: (input: string) => void;
    clearSearch: () => void;
    select: (id: string) => void;
    /** Fetch a page directly, for advancing past the end of the current one. */
    loadPage: (page: number) => Promise<ListResult | null>;
    /** Adopt a fetched page as the current one, keeping the explorer in sync. */
    adoptPage: (page: number, result: ListResult) => void;
}

export function useExtensionList(
    client: ExtlensClient | null,
    status: ConnectionStatus,
    pageSize: number,
    refreshKey: number,
): ExtensionList {
    const [state, setState] = useState<ExplorerState>({
        lights: [],
        stats: null,
        page: 1,
        totalPages: 1,
        search: "",
        searchFocused: false,
        sort: "interestingness_desc",
        selectedIndex: 0,
        loading: false,
        error: null,
    });

    const [debouncedSearch, setDebouncedSearch] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(state.search), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [state.search]);

    const loadPage = useCallback(
        async (page: number): Promise<ListResult | null> => {
            if (!client) return null;
            return client.call<ListResult>("extensions.list", {
                page,
                pageSize,
                search: debouncedSearch || undefined,
                sort: state.sort,
            });
        },
        [client, pageSize, debouncedSearch, state.sort],
    );

    const adoptPage = useCallback(
        (page: number, result: ListResult) => {
            setState((e) => ({
                ...e,
                page,
                // Defense in depth: never render more rows than fit, even if a host ignores
                // pagination — an over-long list pushes the frame past the terminal height.
                lights: result.extensions.slice(0, pageSize),
                stats: result.stats,
                totalPages: result.totalPages,
                selectedIndex: 0,
                loading: false,
                error: null,
            }));
        },
        [pageSize],
    );

    useEffect(() => {
        let cancelled = false;
        if (!client || status !== "connected") {
            setState((e) => ({
                ...e,
                loading: status === "connecting",
                error: status === "connecting" ? null : "not connected",
            }));
            return;
        }
        setState((e) => ({ ...e, loading: true, error: null }));
        void client
            .call<ListResult>("extensions.list", {
                page: state.page,
                pageSize,
                search: debouncedSearch || undefined,
                sort: state.sort,
            })
            .then((result) => {
                if (cancelled) return;
                const lights = result.extensions.slice(0, pageSize);
                setState((e) => ({
                    ...e,
                    lights,
                    stats: result.stats,
                    totalPages: result.totalPages,
                    loading: false,
                    selectedIndex: Math.min(e.selectedIndex, Math.max(0, lights.length - 1)),
                }));
            })
            .catch((error: Error) => {
                if (!cancelled) setState((e) => ({ ...e, loading: false, error: error.message }));
            });
        return () => {
            cancelled = true;
        };
    }, [client, status, state.page, debouncedSearch, state.sort, pageSize, refreshKey]);

    const move = useCallback((delta: 1 | -1) => {
        setState((e) => ({
            ...e,
            selectedIndex: Math.max(0, Math.min(e.lights.length - 1, e.selectedIndex + delta)),
        }));
    }, []);

    const jump = useCallback((to: "top" | "bottom") => {
        setState((e) => ({ ...e, selectedIndex: to === "top" ? 0 : Math.max(0, e.lights.length - 1) }));
    }, []);

    const setPage = useCallback((delta: 1 | -1) => {
        setState((e) => ({
            ...e,
            page: Math.max(1, Math.min(e.totalPages, e.page + delta)),
        }));
    }, []);

    const cycleSort = useCallback(() => {
        setState((e) => ({ ...e, sort: SORTS[(SORTS.indexOf(e.sort) + 1) % SORTS.length] }));
    }, []);

    const focusSearch = useCallback((focused: boolean) => {
        setState((e) => ({ ...e, searchFocused: focused }));
    }, []);

    // Any edit resets to page 1: staying on page 7 of the previous result set shows an empty list.
    const typeSearch = useCallback((input: string) => {
        setState((e) => ({
            ...e,
            search: input === "\b" ? e.search.slice(0, -1) : e.search + input,
            page: 1,
            selectedIndex: 0,
        }));
    }, []);

    const clearSearch = useCallback(() => {
        setState((e) => ({ ...e, search: "", page: 1, selectedIndex: 0 }));
    }, []);

    const select = useCallback((id: string) => {
        setState((e) => {
            const idx = e.lights.findIndex((l) => l.id === id);
            return idx < 0 ? e : { ...e, selectedIndex: idx };
        });
    }, []);

    const selected = useMemo(
        () => state.lights[state.selectedIndex] ?? null,
        [state.lights, state.selectedIndex],
    );

    return {
        state,
        selected,
        move,
        jump,
        setPage,
        cycleSort,
        focusSearch,
        typeSearch,
        clearSearch,
        select,
        loadPage,
        adoptPage,
    };
}
