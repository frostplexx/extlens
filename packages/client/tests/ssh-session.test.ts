import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, createServer, type Server } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSshSession } from "../src/ssh.js";

/**
 * End-to-end session test over a fake `ssh` binary (tests/fixtures/fake-ssh).
 * The fake emulates the OpenSSH surface the client uses: -f backgrounding
 * with a local TCP forwarder, remote commands run through /bin/sh locally,
 * and -O exit. No real ssh server is involved.
 */

const FAKE_BIN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-ssh");

function connectOnce(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let data = "";
    socket.setTimeout(2000);
    socket.once("connect", () => socket.write("ping"));
    socket.on("data", (chunk) => {
      data += chunk.toString();
      socket.end();
    });
    socket.once("end", () => resolve(data));
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("connect timeout")));
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe("openSshSession over the fake ssh", () => {
  let remote: Server;
  let remotePort: number;
  let originalPath: string;

  beforeEach(async () => {
    remote = createServer((socket) => {
      socket.on("data", () => {
        socket.end("pong");
      });
    });
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    const address = remote.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    remotePort = address.port;
    originalPath = process.env.PATH ?? "";
    process.env.PATH = `${FAKE_BIN}:${originalPath}`;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  });

  it("tunnels the WebSocket plane and downloads a directory ref", async () => {
    const session = await openSshSession({ destination: "fakehost", remotePort });
    try {
      // WebSocket plane: a request through the tunnel reaches the host.
      expect(await connectOnce(session.localPort)).toBe("pong");

      // File plane: a directory ref downloads into the cache.
      const tree = mkdtempSync(join(tmpdir(), "extlens-fake-remote-"));
      writeFileSync(join(tree, "manifest.json"), '{"name": "fake"}');
      writeFileSync(join(tree, "bg.js"), "console.log(1)");
      const localPath = await session.downloadRef("mv2", "ext1", tree);
      expect(readFileSync(join(localPath, "manifest.json"), "utf8")).toBe('{"name": "fake"}');
      expect(readFileSync(join(localPath, "bg.js"), "utf8")).toBe("console.log(1)");
      rmSync(tree, { recursive: true, force: true });
    } finally {
      session.close();
    }

    // Teardown closes the local forward.
    const deadline = Date.now() + 5000;
    while (await portOpen(session.localPort)) {
      if (Date.now() > deadline) throw new Error("forwarder stayed up after close");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  it("downloads a single-file ref (manifest.json)", async () => {
    const session = await openSshSession({ destination: "fakehost", remotePort });
    try {
      const file = join(mkdtempSync(join(tmpdir(), "extlens-fake-file-")), "manifest.json");
      writeFileSync(file, '{"name": "single"}');
      const localPath = await session.downloadRef("mv2", "ext2", file);
      expect(readFileSync(localPath, "utf8")).toBe('{"name": "single"}');
    } finally {
      session.close();
    }
  });

  it("surfaces a download failure (missing remote path)", async () => {
    const session = await openSshSession({ destination: "fakehost", remotePort });
    try {
      await expect(
        session.downloadRef("mv2", "ext3", "/no/such/path/on/remote"),
      ).rejects.toThrow(/ssh file download failed/);
    } finally {
      session.close();
    }
  });
});
