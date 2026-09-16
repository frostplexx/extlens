/** Shapes the page uses. Protocol types come from @extlens/protocol; these are the bridge's own. */
import type { BrowserState } from "@extlens/session";

export type BrowserLabel = "mv2" | "mv3";

/** What the page is for right now: browsing the corpus, working a review queue, or reading code. */
export type AppMode = "browse" | "review" | "code";

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

export type SourceStatus = "added" | "removed" | "modified" | "unchanged";

/** One file of an extension, as `local.source.tree` describes it. Mirrors server/source.ts. */
export interface SourceEntry {
    path: string;
    status: SourceStatus;
    size: { mv2?: number; mv3?: number };
    binary: boolean;
}

export interface SourceTree {
    entries: SourceEntry[];
    truncated: boolean;
}

/** One file's contents, from `local.source.file`. */
export interface SourceFile {
    content: string;
    truncated: boolean;
    binary: boolean;
}

/** The server's view of its own connection to the host. */
export interface SessionState {
    connection: "connecting" | "connected" | "disconnected";
    message: string | null;
    tunnel: string | null;
    ssh: string | null;
}
