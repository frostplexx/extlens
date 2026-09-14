/**
 * Migration lifecycle and the log tail.
 *
 * Polled rather than pushed: the host exposes `host.status` and an incremental `host.log`, and
 * teaching the server to fan those out as events would add a second source of truth for no gain
 * at this cadence. A host with no controller answers with an error, which is not a failure —
 * `supported` goes false and the UI hides the controls.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostLogResult, HostStatus, LogLine } from "@extlens/protocol";
import type { BridgeHandle } from "./useBridge.js";

const POLL_MS = 1500;

export interface HostJob {
    status: HostStatus | null;
    supported: boolean;
    error: string | null;
    logs: LogLine[];
    running: boolean;
    toggle: () => void;
}

export function useHostJob(bridge: BridgeHandle, connected: boolean, onFinished: () => void): HostJob {
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
        bridge
            .call<{ status: HostStatus }>("host.status")
            .then((r) => {
                setStatus(r.status);
                setSupported(true);
            })
            .catch(() => setSupported(false));
    }, [bridge, connected]);

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

    return { status, supported, error, logs, running, toggle };
}
