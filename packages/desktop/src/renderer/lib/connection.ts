/**
 * The host connection as one line of status.
 *
 * Four states, told apart because they need different actions: the app's own process not answering,
 * connected, no host chosen yet, and a host that will not answer. The last is the one worth wording
 * carefully, since a tunnel coming up and a refused connection look identical from the outside.
 */
import type { BridgeStatus } from "../bridge";
import type { SessionState } from "../types";

export interface ConnectionLine {
    /** Tailwind background class for the state dot. */
    dot: string;
    label: string;
}

export function connectionLine(status: BridgeStatus, session: SessionState | null): ConnectionLine {
    const target = session?.target ?? null;
    const where = target === null ? "no host" : target.kind === "ssh" ? `ssh ${target.destination}` : target.url;

    if (status !== "open") return { dot: "bg-destructive", label: `bridge ${status}` };
    if (session?.connection === "connected") return { dot: "bg-green", label: where };
    if (target === null) return { dot: "bg-secondary-foreground/40", label: where };

    const detail = session?.tunnel && session.tunnel !== "up" ? `tunnel ${session.tunnel}` : (session?.connection ?? "…");
    return { dot: "bg-peach", label: `${where} · ${detail}` };
}
