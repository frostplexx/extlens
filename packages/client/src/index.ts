#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { openSshSession, parseSshSpec } from "./ssh.js";

/**
 * Client entrypoint. Local host URL: --ws flag, else EXTLENS_WS env, else the
 * default ws://localhost:8081. With --ssh (or EXTLENS_SSH), the client
 * tunnels the WebSocket over SSH to the remote host's port and proxies its
 * file refs; --ssh takes precedence over --ws.
 */
function resolveWsUrl(argv: string[]): string {
  const flagIndex = argv.indexOf("--ws");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  if (process.env.EXLENS_WS) return process.env.EXLENS_WS;
  return "ws://localhost:8081";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sshSpec = parseSshSpec(argv);
  if (!sshSpec) {
    render(React.createElement(App, { wsUrl: resolveWsUrl(argv) }));
    return;
  }

  // The tunnel prompt (password, host key) happens here, in the plain
  // terminal, before the TUI takes over the screen.
  const session = await openSshSession(sshSpec);
  process.stdout.write(
    `ssh: ${sshSpec.destination} — tunnel ws://127.0.0.1:${session.localPort} → localhost:${sshSpec.remotePort}\n`,
  );
  process.on("exit", () => session.close());
  const instance = render(
    React.createElement(App, {
      wsUrl: `ws://127.0.0.1:${session.localPort}`,
      ssh: session,
    }),
  );
  await instance.waitUntilExit();
}

void main().catch((error) => {
  process.stderr.write(`extlens: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
