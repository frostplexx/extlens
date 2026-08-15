import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Consumer smoke tests: import the BUILT package from plain node, ESM and CJS.
 * Each script starts a server, pings it over WebSocket, and shuts down.
 * Run via `npm run build && vitest run` (the package test script does this).
 */

const distEsm = join(import.meta.dirname, "..", "dist", "index.js");
const distCjs = join(import.meta.dirname, "..", "dist", "index.cjs");

const pingOverSocket = `
const { WebSocket } = await import("ws");
const server = createExtlensServer({ port: 0, backend: {} });
const ws = new WebSocket("ws://127.0.0.1:" + server.port);
const timer = setTimeout(() => { console.error("timeout"); process.exit(1); }, 5000);
ws.on("open", () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })));
ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id === 1 && msg.result && msg.result.ok) {
    clearTimeout(timer);
    await server.close();
    process.exit(0);
  } else {
    console.error("unexpected message", raw.toString());
    process.exit(1);
  }
});
ws.on("error", (err) => { console.error("ws error", err); process.exit(1); });
`;

describe("built package consumers", () => {
  test("dist builds exist", () => {
    expect(existsSync(distEsm), `missing ${distEsm}`).toBe(true);
    expect(existsSync(distCjs), `missing ${distCjs}`).toBe(true);
  });

  test("node ESM import: ping over a real socket", () => {
    const script =
      `import { createExtlensServer } from ${JSON.stringify(distEsm)};\n` +
      pingOverSocket;
    const out = execFileSync("node", ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: process.env,
    });
    expect(out).toBe("");
  });

  test("node CJS require: ping over a real socket", () => {
    const script =
      `const { createExtlensServer } = require(${JSON.stringify(distCjs)});\n` +
      pingOverSocket.replace("await import(\"ws\")", "require(\"ws\")");
    const out = execFileSync("node", ["-e", script], { encoding: "utf8", env: process.env });
    expect(out).toBe("");
  });
});
