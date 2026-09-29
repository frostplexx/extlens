/**
 * Runs: which one the host is serving, what else it has, and creating a new one.
 *
 * A run is one model's attempt at one corpus, and the host serves exactly one at a time — each keeps
 * its own directory, because two sharing one would let the second overwrite the first's results. So
 * selecting a run changes what the host serves, not merely a setting, and everything already fetched
 * belongs to the run that was active when it was fetched. `onSwitched` is where the caller refetches.
 *
 * Unsupported is a normal answer, not an error. A host serving a single fixed directory of migrated
 * extensions answers -32601 and the run UI is hidden rather than shown empty.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelsListResult, RunCreateParams, RunInfo, RunsListResult } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";

export interface RunsState {
    runs: RunInfo[];
    /** The host manages runs. False also covers a plain folder of extensions. */
    supported: boolean;
    /** Corpus a new run gets when it names none: what the host was started with. */
    defaultCorpus: string | null;
    active: RunInfo | null;
    /** A create, select or delete is in flight; the UI disables itself rather than queueing clicks. */
    busy: boolean;
    error: string | null;
    /** Models the provider offers. Advisory: any string may be sent. */
    models: ModelsListResult | null;
    create: (params: RunCreateParams) => Promise<RunInfo | null>;
    select: (id: string) => void;
    remove: (id: string) => void;
    reload: () => void;
}

/** A host without the methods answers -32601; the SDK words it, we recognise it. */
function isUnsupported(message: string): boolean {
    return /method not found|does not manage runs|cannot list the provider|-32601/i.test(message);
}

export function useRuns(
    bridge: BridgeHandle,
    connected: boolean,
    /**
     * Called after the active run changed. The host now serves a different set of migrations, so the
     * caller refetches and drops any selection — the same extension id usually exists in both runs,
     * so keeping it would show one run's profile, report and transcript under the other's name.
     */
    onSwitched: (run: RunInfo) => void,
): RunsState {
    const [runs, setRuns] = useState<RunInfo[]>([]);
    const [supported, setSupported] = useState(false);
    const [defaultCorpus, setDefaultCorpus] = useState<string | null>(null);
    const [models, setModels] = useState<ModelsListResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);

    const apply = useCallback((result: RunsListResult) => {
        setRuns(result.runs);
        setDefaultCorpus(result.defaultCorpus);
        setError(null);
    }, []);

    useEffect(() => {
        if (!connected) {
            setSupported(false);
            setRuns([]);
            return;
        }
        let cancelled = false;
        bridge
            .call<RunsListResult>("runs.list")
            .then((result) => {
                if (cancelled) return;
                apply(result);
                setSupported(true);
            })
            .catch((e: Error) => {
                if (cancelled) return;
                setSupported(false);
                setRuns([]);
                // Only a real failure is an error. "This host does not do that" is just a fact.
                setError(isUnsupported(e.message) ? null : e.message);
            });
        return () => {
            cancelled = true;
        };
    }, [bridge, connected, apply, nonce]);

    // The provider's list is fetched once alongside the runs: it is a menu for the new-run form, and
    // a form that has to wait for a network round trip on open feels broken.
    useEffect(() => {
        if (!connected || !supported) return;
        let cancelled = false;
        bridge
            .call<ModelsListResult>("models.list")
            .then((result) => !cancelled && setModels(result))
            // A provider that will not list its models is not a reason to block creating a run; the
            // form falls back to free text and says so.
            .catch(() => !cancelled && setModels(null));
        return () => {
            cancelled = true;
        };
    }, [bridge, connected, supported, nonce]);

    const create = useCallback(
        async (params: RunCreateParams): Promise<RunInfo | null> => {
            setBusy(true);
            try {
                const result = await bridge.call<RunsListResult>("runs.create", { ...params });
                apply(result);
                const active = result.runs.find((r) => r.active) ?? null;
                if (active) onSwitched(active);
                return active;
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                return null;
            } finally {
                setBusy(false);
            }
        },
        [bridge, apply, onSwitched],
    );

    const act = useCallback(
        (method: "runs.select" | "runs.delete", id: string) => {
            setBusy(true);
            bridge
                .call<RunsListResult>(method, { id })
                .then((result) => {
                    apply(result);
                    const active = result.runs.find((r) => r.active);
                    // A delete leaves the active run alone, so only announce a real change.
                    if (active && method === "runs.select") onSwitched(active);
                })
                // Usually HOST_BUSY (a migration is running) or "select another run first" for a
                // delete: both are worth showing rather than swallowing.
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false));
        },
        [bridge, apply, onSwitched],
    );

    return useMemo(
        () => ({
            runs,
            supported,
            defaultCorpus,
            active: runs.find((r) => r.active) ?? null,
            busy,
            error,
            models,
            create,
            select: (id: string) => act("runs.select", id),
            remove: (id: string) => act("runs.delete", id),
            reload: () => setNonce((n) => n + 1),
        }),
        [runs, supported, defaultCorpus, busy, error, models, create, act],
    );
}
