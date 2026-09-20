/** Shapes the page uses. Protocol types come from @extlens/protocol; these are the bridge's own. */
import type { BrowserState } from "@extlens/session";

export type BrowserLabel = "mv2" | "mv3";

/** What the page is for right now: browsing the corpus, working a review queue, reading code, or settings. */
export type AppMode = "browse" | "review" | "code" | "settings";

export interface DownloadPrompt {
    label: BrowserLabel;
    message: string;
}

/** Local state pushed by the main process: what the browsers are doing right now. */
export interface LocalSnapshot {
    browsers: Record<BrowserLabel, BrowserState>;
    prompts: DownloadPrompt[];
    browserDir: string;
}

export type SourceStatus = "added" | "removed" | "modified" | "unchanged";

/** One file of an extension, as `local.source.tree` describes it. Mirrors src/main/source.ts. */
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

/** Where the host is. Mirrors src/main/core.ts. */
export type HostTarget = { kind: "ws"; url: string } | { kind: "ssh"; destination: string; remotePort: number };

/** An ssh password the tunnel is waiting on; answered with `local.session.secret`. */
export interface SecretPrompt {
    id: number;
    destination: string;
    /** A previous answer was rejected. */
    retry: boolean;
}

/** The host connection, as the main process reports it. Mirrors src/main/core.ts. */
export interface SessionState {
    connection: "connecting" | "connected" | "disconnected";
    message: string | null;
    tunnel: "connecting" | "up" | "down" | "reconnecting" | "failed" | null;
    ssh: string | null;
    target: HostTarget | null;
    /** Whether a remembered password would actually be stored (a keychain is available). */
    canRemember: boolean;
    prompt: SecretPrompt | null;
}

/** What the user configured. Mirrors src/main/settings.ts. */
export interface Settings {
    browsers: { dir: string | null; mv2: string | null; mv3: string | null };
}

/** Where a browser executable came from. Mirrors @extlens/session. */
export type ExecutableSource = "configured" | "installed" | "bundled";

/** What the settings page shows about each test browser. Mirrors src/main/core.ts. */
export interface BrowsersStatus {
    dir: { configured: string | null; effective: string };
    mv2: { configured: string | null; resolved: { path: string; source: ExecutableSource } | null };
    mv3: { configured: string | null; resolved: { path: string; source: ExecutableSource } | null };
}
