/**
 * extlens protocol package. The wire contract between the client and any host.
 * See PROTOCOL.md at the repository root for the human-readable spec.
 */
export * from "./messages.js";
export * from "./types.js";

/** The protocol version this package implements. Matches PROTOCOL.md v1. */
export const PROTOCOL_VERSION = "1";
