import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SSH proxying for remote hosts.
 *
 * The client tunnels the WebSocket to the host's remote port and downloads
 * extension file refs into a local cache before browser launch. The client
 * uses the system `ssh` binary: config aliases, jump hosts, host-key
 * verification, key auth, and password auth all come from OpenSSH.
 *
 * One control master serves both planes. `ssh -f -N -M` keeps an
 * authenticated connection alive with a unix-socket control path. File
 * downloads run `ssh -o ControlPath=...` + `tar` through the same socket, so
 * they never re-prompt for a password. `ssh -O exit` tears the master down.
 *
 * Reconnection is automatic. The manager probes the local forward; when it
 * dies, the manager re-establishes on the same port, so the WebSocket client
 * reconnects without being recreated. Auth order: key auth first (BatchMode,
 * never prompts), then a password or passphrase via SSH_ASKPASS. The caller
 * supplies the secret through a prompt; the askpass helper keeps ssh
 * non-interactive, so no terminal handoff is needed while the TUI runs.
 */

export interface SshSpec {
  destination: string;
  remotePort: number;
}

export interface SshSession {
  destination: string;
  localPort: number;
  /** Download a remote file ref into the cache. Returns a local path. */
  downloadRef(label: "mv2" | "mv3", id: string, remoteRef: string): Promise<string>;
}

export type TunnelStatus = "connecting" | "up" | "down" | "reconnecting" | "failed";

export interface SshManagerOptions {
  spec: SshSpec;
  /** Called when ssh needs a password or passphrase. Resolve with "" to cancel. */
  getSecret: () => Promise<string>;
  onStatus: (status: TunnelStatus, message?: string) => void;
  /** The ssh executable; defaults to the system `ssh` on PATH. */
  sshBin?: string;
}

export interface SshManager {
  /** The live session, or null while the tunnel is not up. */
  readonly session: SshSession | null;
  /** The local port the tunnel (re)binds. Null before the first attempt. */
  readonly localPort: number | null;
  /** Begin connecting. No-op once started. */
  start(): void;
  /** Probe the tunnel now; re-establish it if the forward is down. */
  checkNow(): void;
  /** Full teardown: master, timers, cache. Idempotent. */
  stop(): void;
}

/**
 * Resolve the ssh invocation from `--ssh`/`--remote-port` flags and their
 * EXTLENS_SSH / EXTLENS_REMOTE_PORT env vars. Returns null when the client
 * should connect over plain WebSocket instead.
 */
export function parseSshSpec(argv: string[]): SshSpec | null {
  const flagIndex = argv.indexOf("--ssh");
  const flagValue = flagIndex !== -1 && argv[flagIndex + 1] ? argv[flagIndex + 1] : null;
  const destination = flagValue ?? process.env.EXLENS_SSH ?? null;
  if (!destination) return null;

  let remotePort = 8081;
  const portIndex = argv.indexOf("--remote-port");
  if (portIndex !== -1 && argv[portIndex + 1]) remotePort = Number(argv[portIndex + 1]);
  else if (process.env.EXLENS_REMOTE_PORT) remotePort = Number(process.env.EXLENS_REMOTE_PORT);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error(`invalid remote port: ${remotePort}`);
  }
  return { destination, remotePort };
}

/** Strip a file:// prefix from a host file ref. */
export function normalizeRemoteRef(ref: string): string {
  return ref.startsWith("file://") ? fileURLToPath(ref) : ref;
}

/** Quote one path for the remote POSIX shell. */
export function quoteForRemoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createSshManager(options: SshManagerOptions): SshManager {
  let session: SshSession | null = null;
  let state: "idle" | "connecting" | "up" | "down" | "failed" | "stopped" = "idle";
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  let port: number | null = null;
  const { spec } = options;
  const sshBin = options.sshBin ?? "ssh";
  const controlPath = join(
    tmpdir(),
    `extlens-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`,
  );
  const cacheDir = mkdtempSync(join(tmpdir(), "extlens-ssh-"));

  const baseArgs = [
    "-o", `ControlPath=${controlPath}`,
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    // New host keys are accepted silently (the user's hosts are already in
    // known_hosts); changed keys still fail loudly.
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "LogLevel=ERROR",
  ];

  function makeSession(): SshSession {
    const localPort = port as number;
    return {
      destination: spec.destination,
      localPort,
      downloadRef: async (label: "mv2" | "mv3", id: string, remoteRef: string) => {
        const remotePath = normalizeRemoteRef(remoteRef);
        const localDir = join(cacheDir, id, label);
        mkdirSync(localDir, { recursive: true });
        const remoteCommand = [
          "tar",
          "-C", quoteForRemoteShell(dirname(remotePath)),
          "-cf", "-",
          quoteForRemoteShell(basename(remotePath)),
        ].join(" ");
        const { code, stderr } = await streamSsh(
          [
            ...baseArgs,
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=3",
            spec.destination,
            remoteCommand,
          ],
          localDir,
          sshBin,
        );
        if (code !== 0) {
          throw new Error(
            `ssh file download failed (exit ${code}): ${stderr.trim() || remoteRef}`,
          );
        }
        return join(localDir, basename(remotePath));
      },
    };
  }

  async function establish(): Promise<"ok" | "auth-failed" | "cancelled"> {
    if (port === null) port = await freeLocalPort();
    const forwardArgs = [
      "-f", "-N", "-M",
      "-L", `127.0.0.1:${port}:localhost:${spec.remotePort}`,
      spec.destination,
    ];

    // Key auth first; BatchMode never prompts.
    const key = await spawnSsh([...baseArgs, "-o", "BatchMode=yes", ...forwardArgs], "pipe", undefined, sshBin);
    if (key.code === 0) return "ok";
    const keyKind = classifyFailure(key.stderr);
    if (keyKind !== "auth") throw connectionError(spec.destination, key.code, key.stderr);

    // Password or passphrase via askpass; re-prompt up to three times.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const secret = await options.getSecret();
      if (secret === "") return "cancelled";
      const askpass = writeAskpass(secret);
      try {
        const res = await spawnSsh(
          [...baseArgs, "-o", "NumberOfPasswordPrompts=1", ...forwardArgs],
          "pipe",
          {
            ...process.env,
            SSH_ASKPASS: askpass.script,
            SSH_ASKPASS_REQUIRE: "force",
          },
          sshBin,
        );
        if (res.code === 0) return "ok";
        const kind = classifyFailure(res.stderr);
        if (kind !== "auth") throw connectionError(spec.destination, res.code, res.stderr);
      } finally {
        rmSync(askpass.dir, { recursive: true, force: true });
      }
    }
    return "auth-failed";
  }

  async function connect(): Promise<void> {
    let result: "ok" | "auth-failed" | "cancelled";
    try {
      result = await establish();
    } catch (error) {
      if (state === "stopped") return;
      state = "failed";
      options.onStatus("failed", error instanceof Error ? error.message : String(error));
      return;
    }
    if (state === "stopped") return;

    if (result === "ok") {
      await waitForPort(port as number);
      // stop() may have run during the wait; the local narrowing misses it.
      if ((state as string) === "stopped") return;
      session = makeSession();
      state = "up";
      options.onStatus("up");
      startProbe();
    } else if (result === "cancelled") {
      state = "failed";
      options.onStatus("failed", "ssh auth cancelled");
    } else {
      state = "failed";
      options.onStatus("failed", "ssh authentication failed");
    }
  }

  async function teardown(): Promise<void> {
    try {
      spawnSync(
        sshBin,
        [
          ...baseArgs,
          "-o", "BatchMode=yes",
          "-o", "ConnectTimeout=2",
          "-O", "exit",
          spec.destination,
        ],
        { stdio: "ignore" },
      );
    } catch {
      /* the master may already be gone */
    }
    rmSync(controlPath, { force: true });
    // Wait for the local forward to free before a rebind.
    if (port !== null) {
      for (let i = 0; i < 20; i += 1) {
        if (!(await portOpen(port))) return;
        await delay(100);
      }
    }
  }

  async function probe(): Promise<void> {
    if (state !== "up" || port === null) return;
    if (await portOpen(port)) return;
    state = "down";
    options.onStatus("down");
    stopProbe();
    await teardown();
    // stop() may have run during teardown; the local narrowing misses it.
    if ((state as string) === "stopped") return;
    state = "connecting";
    options.onStatus("reconnecting");
    await connect();
  }

  function startProbe(): void {
    stopProbe();
    probeTimer = setInterval(() => void probe(), 2000);
  }

  function stopProbe(): void {
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
  }

  return {
    get session() {
      return session;
    },
    get localPort() {
      return port;
    },
    start() {
      if (state !== "idle") return;
      state = "connecting";
      options.onStatus("connecting");
      void connect();
    },
    checkNow() {
      if (state === "up" && port !== null) void probe();
    },
    stop() {
      state = "stopped";
      stopProbe();
      try {
        spawnSync(
          sshBin,
          [
            ...baseArgs,
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=2",
            "-O", "exit",
            spec.destination,
          ],
          { stdio: "ignore" },
        );
      } catch {
        /* ignore */
      }
      try {
        rmSync(controlPath, { force: true });
      } catch {
        /* ignore */
      }
      try {
        rmSync(cacheDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function writeAskpass(secret: string): { dir: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), "extlens-askpass-"));
  const passwordFile = join(dir, "pw");
  const script = join(dir, "askpass");
  writeFileSync(passwordFile, secret, { mode: 0o600 });
  writeFileSync(
    script,
    `#!/bin/sh\ncat ${quoteForRemoteShell(passwordFile)}\n`,
    { mode: 0o700 },
  );
  return { dir, script };
}

function classifyFailure(stderr: string): "auth" | "connect" | "host-key" | "unknown" {
  const text = stderr.toLowerCase();
  if (
    text.includes("host key verification failed") ||
    text.includes("remote host identification has changed")
  ) {
    return "host-key";
  }
  if (
    text.includes("permission denied") ||
    text.includes("no supported authentication methods") ||
    text.includes("no more authentication methods")
  ) {
    return "auth";
  }
  if (
    text.includes("could not resolve hostname") ||
    text.includes("connection refused") ||
    text.includes("network is unreachable") ||
    text.includes("connection timed out") ||
    text.includes("connection reset") ||
    text.includes("operation timed out")
  ) {
    return "connect";
  }
  return "unknown";
}

function connectionError(destination: string, code: number | null, stderr: string): Error {
  const firstLine = stderr.trim().split("\n")[0];
  return new Error(
    `ssh connection to ${destination} failed (exit ${code}): ${firstLine || "no output"}`,
  );
}

function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("no free port")));
        return;
      }
      const p = address.port;
      probe.close(() => resolve(p));
    });
  });
}

function spawnSsh(
  args: string[],
  capture: "inherit" | "pipe",
  env?: NodeJS.ProcessEnv,
  sshBin = "ssh",
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(sshBin, args, {
      stdio:
        capture === "inherit"
          ? ["inherit", "inherit", "inherit"]
          : ["ignore", "ignore", "pipe"],
      ...(env ? { env } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
}

/** Pipe `ssh <args>` stdout into a local `tar -xf -` in extractDir. */
function streamSsh(
  args: string[],
  extractDir: string,
  sshBin = "ssh",
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const ssh = spawn(sshBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-xf", "-", "-C", extractDir], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let sshErr = "";
    let tarErr = "";
    ssh.stderr?.on("data", (chunk) => {
      sshErr += chunk.toString();
    });
    tar.stderr?.on("data", (chunk) => {
      tarErr += chunk.toString();
    });
    ssh.once("error", reject);
    tar.once("error", reject);
    ssh.stdout.pipe(tar.stdin);

    let sshCode: number | null = null;
    let tarCode: number | null = null;
    const done = () => {
      if (sshCode === null || tarCode === null) return;
      const code = sshCode !== 0 ? sshCode : tarCode;
      resolve({ code, stderr: [sshErr, tarErr].filter(Boolean).join("\n") });
    };
    ssh.once("close", (code) => {
      sshCode = code;
      done();
    });
    tar.once("close", (code) => {
      tarCode = code;
      done();
    });
  });
}

async function waitForPort(port: number, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await portOpen(port)) return;
    await delay(100);
  }
  throw new Error(`ssh forward on 127.0.0.1:${port} did not come up`);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
