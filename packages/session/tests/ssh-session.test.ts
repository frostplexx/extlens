import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, createServer, type Server } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSshManager, type SshManager, type TunnelStatus } from "../src/ssh.js";

/**
 * End-to-end manager tests over a fake `ssh` binary (tests/fixtures/fake-ssh).
 * The fake emulates the OpenSSH surface the client uses: -f backgrounding
 * with a local TCP forwarder, remote commands run through /bin/sh locally,
 * -O exit, optional key-auth failure, and an SSH_ASKPASS password flow.
 * Tunnel death is simulated with a kill file. No real ssh server is involved.
 */

const FAKE_BIN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-ssh", "ssh");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check: () => boolean | Promise<boolean>, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error("waitUntil timed out");
}

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

describe("createSshManager over the fake ssh", () => {
  let remote: Server;
  let remotePort: number;
  let statuses: TunnelStatus[];

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
    statuses = [];
  });

  afterEach(async () => {
    delete process.env.FAKE_SSH_KEY_AUTH;
    delete process.env.FAKE_SSH_EXPECTED_PASSWORD;
    delete process.env.KILL_FILE;
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  });

  function manager(getSecret: () => Promise<string> = async () => ""): SshManager {
    return createSshManager({
      spec: { destination: "fakehost", remotePort },
      getSecret,
      sshBin: FAKE_BIN,
      onStatus: (status) => statuses.push(status),
    });
  }

  it("tunnels, downloads a directory ref, and tears down", async () => {
    const m = manager();
    m.start();
    await waitUntil(() => statuses.includes("up"));

    // WebSocket plane: a request through the tunnel reaches the host.
    expect(await connectOnce(m.localPort as number)).toBe("pong");

    // File plane: a directory ref downloads into the cache.
    const tree = mkdtempSync(join(tmpdir(), "extlens-fake-remote-"));
    writeFileSync(join(tree, "manifest.json"), '{"name": "fake"}');
    writeFileSync(join(tree, "bg.js"), "console.log(1)");
    const localPath = await (m.session as NonNullable<typeof m.session>).downloadRef(
      "mv2",
      "ext1",
      tree,
    );
    expect(readFileSync(join(localPath, "manifest.json"), "utf8")).toBe('{"name": "fake"}');
    expect(readFileSync(join(localPath, "bg.js"), "utf8")).toBe("console.log(1)");
    rmSync(tree, { recursive: true, force: true });

    m.stop();
    await waitUntil(async () => !(await portOpen(m.localPort as number)));
  });

  it("downloads a single-file ref (manifest.json)", async () => {
    const m = manager();
    m.start();
    await waitUntil(() => statuses.includes("up"));
    const file = join(mkdtempSync(join(tmpdir(), "extlens-fake-file-")), "manifest.json");
    writeFileSync(file, '{"name": "single"}');
    const localPath = await (m.session as NonNullable<typeof m.session>).downloadRef(
      "mv2",
      "ext2",
      file,
    );
    expect(readFileSync(localPath, "utf8")).toBe('{"name": "single"}');
    m.stop();
  });

  it("surfaces a download failure (missing remote path)", async () => {
    const m = manager();
    m.start();
    await waitUntil(() => statuses.includes("up"));
    await expect(
      (m.session as NonNullable<typeof m.session>).downloadRef(
        "mv2",
        "ext3",
        "/no/such/path/on/remote",
      ),
    ).rejects.toThrow(/ssh file download failed/);
    m.stop();
  });

  it("reconnects automatically after the tunnel dies (key auth)", async () => {
    const killFile = join(tmpdir(), `extlens-kill-${Date.now()}`);
    process.env.KILL_FILE = killFile;
    const m = manager();
    m.start();
    await waitUntil(() => statuses.includes("up"));
    const port = m.localPort as number;

    // Simulate the master dying: the forwarder exits and the port closes.
    writeFileSync(killFile, "");
    await waitUntil(async () => !(await portOpen(port)));

    // The manager detects the death and re-establishes on the same port.
    await waitUntil(() => statuses.filter((s) => s === "up").length >= 2);
    expect(await connectOnce(port)).toBe("pong");

    // The file plane works again through the new master.
    const tree = mkdtempSync(join(tmpdir(), "extlens-fake-remote-"));
    writeFileSync(join(tree, "manifest.json"), "{}");
    const localPath = await (m.session as NonNullable<typeof m.session>).downloadRef(
      "mv2",
      "ext4",
      tree,
    );
    expect(readFileSync(join(localPath, "manifest.json"), "utf8")).toBe("{}");
    rmSync(tree, { recursive: true, force: true });
    m.stop();
  });

  it("asks for the password via getSecret and re-prompts on a wrong one", async () => {
    process.env.FAKE_SSH_KEY_AUTH = "fail";
    process.env.FAKE_SSH_EXPECTED_PASSWORD = "hunter2";
    let calls = 0;
    const m = manager(async () => {
      calls += 1;
      return calls === 1 ? "wrong" : "hunter2";
    });
    m.start();
    await waitUntil(() => statuses.includes("up"));
    expect(calls).toBe(2);
    expect(await connectOnce(m.localPort as number)).toBe("pong");
    m.stop();
  });

  it("re-prompts for the password after a reconnect", async () => {
    process.env.FAKE_SSH_KEY_AUTH = "fail";
    process.env.FAKE_SSH_EXPECTED_PASSWORD = "hunter2";
    const killFile = join(tmpdir(), `extlens-kill-${Date.now()}`);
    process.env.KILL_FILE = killFile;
    let calls = 0;
    const m = manager(async () => {
      calls += 1;
      return "hunter2";
    });
    m.start();
    await waitUntil(() => statuses.includes("up"));
    const port = m.localPort as number;
    const callsBeforeDeath = calls;

    writeFileSync(killFile, "");
    await waitUntil(async () => !(await portOpen(port)));
    await waitUntil(() => statuses.filter((s) => s === "up").length >= 2);

    // The re-established tunnel prompted for the password again.
    expect(calls).toBeGreaterThan(callsBeforeDeath);
    expect(await connectOnce(port)).toBe("pong");
    m.stop();
  });

  it("gives up with a clear failure when the user cancels the prompt", async () => {
    process.env.FAKE_SSH_KEY_AUTH = "fail";
    const m = manager(async () => "");
    m.start();
    await waitUntil(() => statuses.includes("failed"));
    expect(m.session).toBeNull();
    m.stop();
  });
});
