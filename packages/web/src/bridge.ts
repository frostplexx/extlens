/**
 * The page's connection to its local server.
 *
 * One WebSocket carries two things: request/response for RPC (id-matched, promise-per-request)
 * and server-pushed events for state the page does not own — the connection to the host, and what
 * the local browsers are doing. Browser state is pushed rather than polled because it changes on
 * the server's schedule (a download progressing, Chrome being closed by hand), and a tab that
 * polled would be wrong between ticks.
 *
 * Reconnect is unconditional and cheap: the server is on localhost, so a drop means it restarted,
 * and the right response is to attach again rather than to show an error and give up.
 */
export type BridgeStatus = "connecting" | "open" | "closed";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class Bridge {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private listeners = new Map<string, Set<(payload: unknown) => void>>();
    private retry: ReturnType<typeof setTimeout> | null = null;
    private closed = false;

    constructor(
        private url: string,
        private onStatus: (status: BridgeStatus) => void,
    ) {}

    start(): void {
        this.closed = false;
        this.connect();
    }

    stop(): void {
        this.closed = true;
        if (this.retry) clearTimeout(this.retry);
        this.ws?.close();
    }

    /** Subscribe to a server-pushed event. Returns an unsubscribe function. */
    on(event: string, handler: (payload: unknown) => void): () => void {
        const set = this.listeners.get(event) ?? new Set();
        set.add(handler);
        this.listeners.set(event, set);
        return () => set.delete(handler);
    }

    call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const ws = this.ws;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                reject(new Error("not connected"));
                return;
            }
            const id = this.nextId++;
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    private connect(): void {
        this.onStatus("connecting");
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => this.onStatus("open");
        ws.onclose = () => {
            this.onStatus("closed");
            // Every in-flight call belongs to a socket that no longer exists.
            for (const [, pending] of this.pending) pending.reject(new Error("connection lost"));
            this.pending.clear();
            if (!this.closed) this.retry = setTimeout(() => this.connect(), 1000);
        };
        ws.onmessage = (event) => {
            const msg = JSON.parse(String(event.data)) as {
                id?: number;
                result?: unknown;
                error?: string;
                event?: string;
                payload?: unknown;
            };
            if (msg.event) {
                for (const handler of this.listeners.get(msg.event) ?? []) handler(msg.payload);
                return;
            }
            if (typeof msg.id !== "number") return;
            const pending = this.pending.get(msg.id);
            if (!pending) return;
            this.pending.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error));
            else pending.resolve(msg.result);
        };
    }
}

/**
 * The bridge URL for this page. The token is in the query string the server printed, and is kept
 * there rather than copied into storage so that closing the tab ends the grant.
 */
export function bridgeUrl(): string {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // In `vite dev` the page is on :5173 while the server is on :8090; everywhere else they are
    // the same origin.
    const host = import.meta.env.DEV ? `127.0.0.1:${import.meta.env.VITE_BRIDGE_PORT ?? "8090"}` : window.location.host;
    return `${proto}://${host}/bridge?token=${encodeURIComponent(token)}`;
}
