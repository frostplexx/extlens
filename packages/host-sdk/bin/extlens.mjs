#!/usr/bin/env node
/**
 * extlens serve — standalone folder mode. Serves a plain directory of Chrome
 * extensions over the extlens protocol, no host project required. The client
 * connects with EXTLENS_WS=ws://127.0.0.1:8081 or `--ws`.
 */
import { createExtlensServer, createFolderBackend } from "extlens-sdk";

function usage() {
  console.error("usage: extlens serve <folder> [--port N] [--host H] [--db PATH]");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] !== "serve" || args.length < 2) usage();
const folder = args[1];

function value(flag, fallback) {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
}

const port = Number(value("--port", "8081"));
if (!Number.isInteger(port) || port < 0 || port > 65535) usage();
const host = value("--host", undefined);
const dbPath = value("--db", undefined);

let done = 0;
const backend = createFolderBackend(folder, {
  dbPath,
  onProgress: (d, total) => {
    if (done === 0) process.stderr.write(`extlens: indexing ${total} extensions…`);
    done = d;
  },
});
if (done > 0) process.stderr.write(" done\n");
const server = createExtlensServer({ port, host, backend });
process.stderr.write(
  `extlens: serving ${folder} on ws://${host ?? "127.0.0.1"}:${server.port}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
