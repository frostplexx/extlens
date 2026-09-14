/**
 * Shapes shared by everything that drives a session, independent of how it is displayed.
 *
 * These live here rather than in a client because both front ends need them: the ink TUI renders
 * a browser phase as a coloured word, the web UI renders it as a pill, and neither owns the
 * concept.
 */

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type BrowserPhase =
    | "idle"
    | "launching"
    | "detecting"
    | "loaded"
    | "failed"
    | "closed"
    | "downloading";

export interface BrowserState {
    phase: BrowserPhase;
    message: string | null;
    /** The id Chrome assigned the unpacked extension, once it has loaded. */
    extensionId: string | null;
}
