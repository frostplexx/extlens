/**
 * Bridge lifecycle, plus the two pieces of state the server pushes.
 *
 * Everything else in the app calls `call()` and owns its own data; this hook exists so that the
 * socket is created once for the page rather than once per component.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bridge, bridgeUrl, type BridgeStatus } from "../bridge";
import type { LocalSnapshot, SessionState } from "../types";

const IDLE_LOCAL: LocalSnapshot = {
    browsers: {
        mv2: { phase: "idle", message: null, extensionId: null },
        mv3: { phase: "idle", message: null, extensionId: null },
    },
    prompts: [],
    browserDir: "",
};

export interface BridgeHandle {
    status: BridgeStatus;
    session: SessionState | null;
    local: LocalSnapshot;
    call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

export function useBridge(): BridgeHandle {
    const bridgeRef = useRef<Bridge | null>(null);
    const [status, setStatus] = useState<BridgeStatus>("connecting");
    const [session, setSession] = useState<SessionState | null>(null);
    const [local, setLocal] = useState<LocalSnapshot>(IDLE_LOCAL);

    if (!bridgeRef.current) bridgeRef.current = new Bridge(bridgeUrl(), setStatus);

    useEffect(() => {
        const bridge = bridgeRef.current!;
        const offSession = bridge.on("session", (p) => setSession(p as SessionState));
        const offLocal = bridge.on("local.browsers", (p) => setLocal(p as LocalSnapshot));
        bridge.start();
        return () => {
            offSession();
            offLocal();
            bridge.stop();
        };
    }, []);

    return useMemo(
        () => ({
            status,
            session,
            local,
            call: <T,>(method: string, params: Record<string, unknown> = {}) =>
                bridgeRef.current!.call<T>(method, params),
        }),
        [status, session, local],
    );
}
