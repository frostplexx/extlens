#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { parseSshSpec } from "@extlens/session";

/**
 * Client entrypoint. Local host URL: --ws flag, else EXTLENS_WS env, else the
 * default ws://localhost:8081. With --ssh (or EXTLENS_SSH), the App tunnels
 * the WebSocket over SSH to the remote host's port and proxies its file refs;
 * --ssh takes precedence over --ws.
 */
function resolveWsUrl(argv: string[]): string {
  const flagIndex = argv.indexOf("--ws");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  if (process.env.EXTLENS_WS ?? process.env.EXLENS_WS) return (process.env.EXTLENS_WS ?? process.env.EXLENS_WS) as string;
  return "ws://localhost:8081";
}

function main(): void {
  const argv = process.argv.slice(2);
  const sshSpec = parseSshSpec(argv);
  // Clear the terminal so the TUI starts on a clean full screen.
  process.stdout.write("\u001b[2J\u001b[H");
  render(
    React.createElement(App, {
      wsUrl: resolveWsUrl(argv),
      sshSpec: sshSpec ?? null,
    }),
  );
}

main();
