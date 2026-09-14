/**
 * One extension's profile, file refs and saved report, loaded together.
 *
 * The id guard matters more here than in the terminal: a click moves the selection instantly, and
 * a slow host would otherwise paint extension A's profile over extension B's row selection.
 */
import { useEffect, useState } from "react";
import type { ExtensionProfile, FileRefs, Report } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";

export interface ProfileState {
    profile: ExtensionProfile | null;
    files: FileRefs | null;
    report: Report | null;
    /**
     * Which extension the data above actually belongs to.
     *
     * Not the same as the id that was asked for: between changing extension and the fetch
     * resolving, `files` still holds the PREVIOUS extension's paths. Displaying that for a moment
     * is harmless; launching a browser with it opens the wrong extension, which is what happened —
     * the pane said one extension while Chrome loaded the one before it. Anything that ACTS on
     * these fields must check this first.
     */
    loadedId: string | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

export function useProfile(bridge: BridgeHandle, id: string | null, connected: boolean): ProfileState {
    const [profile, setProfile] = useState<ExtensionProfile | null>(null);
    const [files, setFiles] = useState<FileRefs | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!id || !connected) {
            setProfile(null);
            setFiles(null);
            setReport(null);
            setLoadedId(null);
            return;
        }
        let cancelled = false;
        // The previous extension's data is stale the instant the id changes, so it stops being
        // attributed to anything until the new fetch lands.
        setLoadedId(null);
        setLoading(true);
        setError(null);
        void Promise.all([
            bridge.call<{ extension: ExtensionProfile }>("extensions.get", { id }),
            bridge.call<{ files: FileRefs }>("extensions.files", { id }),
            bridge.call<{ report: Report | null }>("reports.get", { extensionId: id }),
        ])
            .then(([got, gotFiles, gotReport]) => {
                if (cancelled) return;
                setProfile(got.extension);
                setFiles(gotFiles.files);
                setReport(gotReport.report);
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
    }, [bridge, id, connected, nonce]);

    return { profile, files, report, loadedId, loading, error, reload: () => setNonce((n) => n + 1) };
}
