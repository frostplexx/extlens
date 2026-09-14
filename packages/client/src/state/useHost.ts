/**
 * Host lifecycle: migration status, the incremental log tail, and start/stop.
 *
 * A host need not implement any of this — `extlens serve <folder>` has no HostController — so
 * every call here degrades rather than errors: a failing host.status sets `supported: false` and
 * the UI hides the segment, and a failing host.log leaves the dock on status.message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostLogResult, HostStatus, LogLine } from "@extlens/protocol";
import type { ExtlensClient } from "../api.js";
import type { ConnectionStatus } from "../types.js";

/** How often to re-read host.status and host.log while a job runs. */
const POLL_MS = 1500;

export interface HostState {
    status: HostStatus | null;
    /** False once host.status fails: this host has no controller, so hide the UI for it. */
    supported: boolean;
    error: string | null;
    logs: LogLine[];
    /** Start the batch, or stop a running job. */
    toggle: () => void;
    /** Bumped when a job ends, because the corpus may have gained a run row. */
    refreshKey: number;
}

export function useHost(client: ExtlensClient | null, status: ConnectionStatus): HostState {
    const [state, setState] = useState<{ status: HostStatus | null; supported: boolean; error: string | null }>({
        status: null,
        supported: true,
        error: null,
    });
    const [logs, setLogs] = useState<LogLine[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    // Largest log seq already appended, and the job it belongs to.
    const logOffset = useRef(0);
    const prevRunStart = useRef<string | null>(null);

    // One status read per connect. Failure means no HostController; stop showing the segment.
    useEffect(() => {
        if (!client || status !== "connected") return;
        let cancelled = false;
        void client
            .call<{ status: HostStatus }>("host.status")
            .then((r) => !cancelled && setState((s) => ({ ...s, status: r.status, supported: true })))
            .catch(() => !cancelled && setState((s) => ({ ...s, status: null, supported: false })));
        return () => {
            cancelled = true;
        };
    }, [client, status]);

    const fetchLogs = useCallback(() => {
        if (!client) return;
        void client
            .call<HostLogResult>("host.log", { offset: logOffset.current })
            .then((r) => {
                const fresh = r.lines.filter((line) => line.seq > logOffset.current);
                if (fresh.length) setLogs((prev) => [...prev, ...fresh]);
                logOffset.current = Math.max(logOffset.current, r.nextOffset);
            })
            .catch(() => {
                /* host without host.log: the dock falls back to status.message */
            });
    }, [client]);

    const jobState = state.status?.state;
    const startedAt = state.status?.startedAt ?? null;

    useEffect(() => {
        if (!client || status !== "connected" || !jobState) return;
        const active = jobState === "running" || jobState === "stopping";
        // A new startedAt is a new job: reset the dock and re-read the log from seq 1.
        if (active && startedAt !== prevRunStart.current) {
            setLogs([]);
            logOffset.current = 0;
        }
        prevRunStart.current = active ? startedAt : null;
        if (!active) return;
        const timer = setInterval(() => {
            void client
                .call<{ status: HostStatus }>("host.status")
                .then((r) => {
                    setState((s) => ({ ...s, status: r.status }));
                    if (r.status.state === "idle") {
                        setRefreshKey((k) => k + 1);
                        fetchLogs();
                    }
                })
                .catch((error: Error) => setState((s) => ({ ...s, error: error.message })));
            fetchLogs();
        }, POLL_MS);
        fetchLogs();
        return () => clearInterval(timer);
    }, [client, status, jobState, startedAt, fetchLogs]);

    const toggle = useCallback(() => {
        if (!client || status !== "connected") return;
        const running = jobState === "running" || jobState === "stopping";
        const method = running ? "host.stop" : "host.startAll";
        void client
            .call<{ status: HostStatus }>(method)
            .then((r) => {
                setState((s) => ({ ...s, status: r.status, error: null }));
                if (running) setRefreshKey((k) => k + 1);
            })
            .catch((error: Error) => setState((s) => ({ ...s, error: error.message })));
    }, [client, status, jobState]);

    return { ...state, logs, toggle, refreshKey };
}
