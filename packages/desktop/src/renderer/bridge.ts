/**
 * The page's connection to the main process.
 *
 * One call in, events out. The preload script (src/preload/index.ts) exposes exactly that as
 * `window.extlens`; this wraps it so the rest of the page holds a `Bridge` and never the raw API.
 *
 * There is no connection to lose: the page and the process share a lifetime, so the status is
 * "open" from `start()` on. Events are pushed rather than polled because they change on the
 * process's schedule (a download progressing, Chrome being closed by hand), and a page that
 * polled would be wrong between ticks. A freshly attached page asks for a replay of the current
 * state, since the events that established it were sent before anyone was listening.
 */
export type BridgeStatus = "connecting" | "open" | "closed";

export interface Bridge {
    start(): void;
    stop(): void;
    /** Subscribe to a pushed event. Returns an unsubscribe function. */
    on(event: string, handler: (payload: unknown) => void): () => void;
    call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

/** What the preload script puts on `window`. Mirrors src/preload/index.ts. */
export interface DesktopApi {
    platform: string;
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
    on(event: string, handler: (payload: unknown) => void): () => void;
}

declare global {
    interface Window {
        extlens?: DesktopApi;
    }
}

export class IpcBridge implements Bridge {
    private offs: (() => void)[] = [];

    constructor(
        private api: DesktopApi,
        private onStatus: (status: BridgeStatus) => void,
    ) {}

    start(): void {
        this.onStatus("open");
        void this.api.call("local.replay", {}).catch(() => {});
    }

    stop(): void {
        for (const off of this.offs) off();
        this.offs = [];
        this.onStatus("closed");
    }

    on(event: string, handler: (payload: unknown) => void): () => void {
        const off = this.api.on(event, handler);
        this.offs.push(off);
        return () => {
            off();
            this.offs = this.offs.filter((f) => f !== off);
        };
    }

    call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        return this.api.call(method, params) as Promise<T>;
    }
}

/** The OS this window is on, for layout that depends on where the window controls are. */
export function platform(): "darwin" | "win32" | "linux" | "other" {
    const p = window.extlens?.platform;
    return p === "darwin" || p === "win32" || p === "linux" ? p : "other";
}

export function createBridge(onStatus: (status: BridgeStatus) => void): Bridge {
    const api = window.extlens;
    // Only ever true when the page is opened outside Electron — a stray vite tab, say.
    if (!api) throw new Error("extlens must run inside the desktop app: window.extlens is missing");
    return new IpcBridge(api, onStatus);
}
