/**
 * Migration lifecycle and the log tail.
 *
 * Polled rather than pushed: the host exposes `host.status` and an incremental `host.log`, and
 * teaching the main process to fan those out as events would add a second source of truth for no gain
 * at this cadence. A host with no controller answers with an error, which is not a failure —
 * `supported` goes false and the UI hides the controls.
 *
 * But "has no controller" is a property of the RUN, not of the host: a host serving no run yet has
 * nothing to start, and gains a controller the moment one exists. So `runKey` re-asks on every change
 * of active run. Without it the first answer latched forever — connect to an empty runs root, create a
 * run, and the migration would start and run to completion with the UI showing no controls, no status
 * and an empty log, because nothing ever asked again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostLogResult, HostStatus, LogLine } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge";

const POLL_MS = 1500;

export interface HostJob {
    status: HostStatus | null;
    supported: boolean;
    error: string | null;
    logs: LogLine[];
    running: boolean;
    toggle: () => void;
    /**
     * Start the batch, and adopt the status it answers with.
     *
     * Separate from `toggle` for callers that know they are starting — creating a run, say — where
     * toggling would mean "stop" if a job happened to be running, and where firing the call through
     * the bridge directly would leave this hook's status stale and the dock empty.
     */
    start: () => Promise<void>;
}

export function useHostJob(
    bridge: BridgeHandle,
    connected: boolean,
    onFinished: () => void,
    /** Identity of the active run. A change re-asks whether the host can start anything. */
    runKey: string | null = null,
): HostJob {
    const [status, setStatus] = useState<HostStatus | null>(null);
    const [supported, setSupported] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<LogLine[]>([]);
    const offset = useRef(0);
    const startedAt = useRef<string | null>(null);

    const running = status?.state === "running" || status?.state === "stopping";

    const fetchLogs = useCallback(() => {
        bridge
            .call<HostLogResult>("host.log", { offset: offset.current })
            .then((r) => {
                const fresh = r.lines.filter((l) => l.seq > offset.current);
                if (fresh.length) setLogs((prev) => [...prev, ...fresh]);
                offset.current = Math.max(offset.current, r.nextOffset);
            })
            .catch(() => {
                /* a host without host.log simply has no dock content */
            });
    }, [bridge]);

    useEffect(() => {
        if (!connected) return;
        let cancelled = false;
        bridge
            .call<{ status: HostStatus }>("host.status")
            .then((r) => {
                if (cancelled) return;
                setStatus(r.status);
                setSupported(true);
            })
            .catch(() => {
                if (cancelled) return;
                // Not a failure: this host, right now, has nothing to start. Asked again whenever
                // the active run changes, since that is what gives it something.
                setStatus(null);
                setSupported(false);
            });
        return () => {
            cancelled = true;
        };
    }, [bridge, connected, runKey]);

    useEffect(() => {
        if (!connected || !supported) return;
        // A new startedAt is a new job: drop the previous job's lines rather than concatenating
        // two runs into one dock.
        if (running && status?.startedAt !== startedAt.current) {
            setLogs([]);
            offset.current = 0;
            startedAt.current = status?.startedAt ?? null;
        }
        if (!running) return;
        const timer = setInterval(() => {
            bridge
                .call<{ status: HostStatus }>("host.status")
                .then((r) => {
                    setStatus(r.status);
                    if (r.status.state === "idle") {
                        fetchLogs();
                        onFinished();
                    }
                })
                .catch((e: Error) => setError(e.message));
            fetchLogs();
        }, POLL_MS);
        fetchLogs();
        return () => clearInterval(timer);
    }, [bridge, connected, supported, running, status?.startedAt, fetchLogs, onFinished]);

    const toggle = useCallback(() => {
        bridge
            .call<{ status: HostStatus }>(running ? "host.stop" : "host.startAll")
            .then((r) => {
                setStatus(r.status);
                setError(null);
                if (running) onFinished();
            })
            .catch((e: Error) => setError(e.message));
    }, [bridge, running, onFinished]);

    const start = useCallback(async () => {
        try {
            const r = await bridge.call<{ status: HostStatus }>("host.startAll");
            setStatus(r.status);
            setSupported(true);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            throw e;
        }
    }, [bridge]);

    return { status, supported, error, logs, running, toggle, start };
}
