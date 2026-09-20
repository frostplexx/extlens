/**
 * An extension's source, as the code explorer reads it: the tree once, then files on demand.
 *
 * Both are read through the bridge's `local.source.*` methods, which take the same file refs a
 * browser launch does — so whatever the app can open in Chrome it can also show as code.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileRefs } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";
import type { BrowserLabel, SourceFile, SourceTree } from "../types";

export interface SourceTreeState {
    tree: SourceTree | null;
    /** Which extension `tree` belongs to; see useProfile for why this is not the requested id. */
    loadedId: string | null;
    loading: boolean;
    error: string | null;
}

/** The file tree, fetched only while `enabled` — browsing rows must never walk directories. */
export function useSourceTree(
    bridge: BridgeHandle,
    files: FileRefs | null,
    id: string | null,
    enabled: boolean,
): SourceTreeState {
    const [tree, setTree] = useState<SourceTree | null>(null);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !id || !files) {
            setTree(null);
            setLoadedId(null);
            return;
        }
        let cancelled = false;
        setLoadedId(null);
        setLoading(true);
        setError(null);
        bridge
            .call<SourceTree>("local.source.tree", { files, id })
            .then((got) => {
                if (cancelled) return;
                setTree(got);
                setLoadedId(id);
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
    }, [bridge, files, id, enabled]);

    return { tree, loadedId, loading, error };
}

export interface SourceFileState {
    file: SourceFile | null;
    loading: boolean;
    error: string | null;
}

/**
 * One file of one variant. Cached per extension so that flipping between Diff and a single
 * variant, or coming back to a file, is instant — and so the diff view's two reads of the same
 * path do not turn into four when the view toggles.
 */
export function useSourceFile(
    bridge: BridgeHandle,
    files: FileRefs | null,
    id: string | null,
    label: BrowserLabel | null,
    path: string | null,
): SourceFileState {
    const cache = useRef<{ id: string | null; entries: Map<string, SourceFile> }>({ id: null, entries: new Map() });
    const [state, setState] = useState<SourceFileState>({ file: null, loading: false, error: null });

    const lookup = useCallback(
        (key: string): SourceFile | undefined => {
            if (cache.current.id !== id) cache.current = { id, entries: new Map() };
            return cache.current.entries.get(key);
        },
        [id],
    );

    useEffect(() => {
        if (!files || !id || !label || !path) {
            setState({ file: null, loading: false, error: null });
            return;
        }
        const key = `${label}:${path}`;
        const hit = lookup(key);
        if (hit) {
            setState({ file: hit, loading: false, error: null });
            return;
        }
        let cancelled = false;
        setState({ file: null, loading: true, error: null });
        bridge
            .call<SourceFile>("local.source.file", { files, id, label, path })
            .then((got) => {
                cache.current.entries.set(key, got);
                if (!cancelled) setState({ file: got, loading: false, error: null });
            })
            .catch((e: Error) => {
                if (!cancelled) setState({ file: null, loading: false, error: e.message });
            });
        return () => {
            cancelled = true;
        };
    }, [bridge, files, id, label, path, lookup]);

    return state;
}
