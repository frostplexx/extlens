/** Shapes the page uses. Protocol types come from @extlens/protocol; these are the bridge's own. */
import type { BrowserState } from "@extlens/session";

export type BrowserLabel = "mv2" | "mv3";

export interface DownloadPrompt {
    label: BrowserLabel;
    message: string;
}

/** Local state pushed by the server: what the browsers are doing right now. */
export interface LocalSnapshot {
    browsers: Record<BrowserLabel, BrowserState>;
    prompts: DownloadPrompt[];
    browserDir: string;
}

/** The server's view of its own connection to the host. */
export interface SessionState {
    connection: "connecting" | "connected" | "disconnected";
    message: string | null;
    tunnel: string | null;
    ssh: string | null;
}
