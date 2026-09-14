/**
 * @extlens/session — the node-side half of a review session.
 *
 * Talking to a host (over a plain WebSocket or through an ssh tunnel) and driving local Chrome
 * for Testing builds are the same work whether the UI is a terminal or a browser tab, so they
 * live here instead of inside one of the front ends. The rule for this package: no UI framework,
 * no rendering, no assumptions about who is watching.
 */
export { ExtlensClient } from "./api.js";
export { createSshManager, parseSshSpec } from "./ssh.js";
export type { SshManager, SshSession, SshSpec, TunnelStatus } from "./ssh.js";
export { BrowserManager, resolveExecutable } from "./browsers/manager.js";
export { BROWSER_DIR, installChrome, missingBrowserMessage } from "./browsers/install.js";
export { detectExtensionLoad } from "./browsers/load-status.js";
export type { BrowserPhase, BrowserState, ConnectionStatus } from "./types.js";
