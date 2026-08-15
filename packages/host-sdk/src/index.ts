/**
 * extlens-sdk: embed the extlens protocol in any host project.
 *
 * A host implements the Backend interface over its own storage and starts a
 * server:
 *
 *   import { createExtlensServer, type Backend } from "extlens-sdk";
 *   const server = createExtlensServer({ port: 8081, backend: myBackend });
 *
 * The SDK validates every message (zod), dispatches to the backend, computes
 * profiles with the analyzer when the host has no analysis, and serves the
 * protocol from PROTOCOL.md over WebSocket. It has no dependency on ink,
 * react, or the client.
 */
import { startServer } from "./ws.js";
import type { ExtlensServerHandle, ExtlensServerOptions } from "./ws.js";

export { RpcError } from "./rpc.js";
export { computeProfile, summarizeManifest } from "./profile.js";
export type { Backend, GetExtensionResult, HostController } from "./backend.js";

export * from "@extlens/protocol";
export type { ExtensionSource, Manifest, SourceFile } from "@extlens/analyzer";

/** Start an extlens server. The returned handle can close it. */
export function createExtlensServer(options: ExtlensServerOptions): ExtlensServerHandle {
  return startServer(options);
}
