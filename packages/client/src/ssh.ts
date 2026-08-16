import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SSH proxying for remote hosts.
 *
 * The client tunnels the WebSocket to the host's remote port and downloads
 * extension file refs into a local cache before browser launch. The client
 * uses the system `ssh` binary: config aliases, jump hosts, host-key
 * verification, key auth, and password prompts all come from OpenSSH. The
 * password prompt appears before the TUI renders, in the plain terminal, so
 * it never conflicts with ink's raw mode.
 *
 * One control master serves both planes. `ssh -f -N -M` keeps an
 * authenticated connection alive with a unix-socket control path. File
 * downloads run `ssh -o ControlPath=...` + `tar` through the same socket, so
 * they never re-prompt for a password. `ssh -O exit` tears the master down.
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
  /** Tear down the tunnel, the control master, and the cache. */
  close(): void;
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

/** Establish the tunnel and return a session bound to one control master. */
export async function openSshSession(spec: SshSpec): Promise<SshSession> {
  const localPort = await freeLocalPort();
  const controlPath = join(tmpdir(), `extlens-${process.pid}.sock`);
  const cacheDir = mkdtempSync(join(tmpdir(), "extlens-ssh-"));

  const baseArgs = [
    "-o", `ControlPath=${controlPath}`,
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "LogLevel=ERROR",
  ];

  const { code } = await spawnSsh(
    [
      ...baseArgs,
      "-f", "-N", "-M",
      "-L", `127.0.0.1:${localPort}:localhost:${spec.remotePort}`,
      spec.destination,
    ],
    "inherit",
  );
  if (code !== 0) {
    rmSync(controlPath, { force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    throw new Error(`ssh connection to ${spec.destination} failed (exit ${code})`);
  }
  await waitForPort(localPort);

  const downloadRef = async (
    label: "mv2" | "mv3",
    id: string,
    remoteRef: string,
  ): Promise<string> => {
    const remotePath = normalizeRemoteRef(remoteRef);
    const localDir = join(cacheDir, id, label);
    mkdirSync(localDir, { recursive: true });
    const remoteCommand = [
      "tar",
      "-C", quoteForRemoteShell(dirname(remotePath)),
      "-cf", "-",
      quoteForRemoteShell(basename(remotePath)),
    ].join(" ");
    const { code: copyCode, stderr } = await streamSsh(
      [
        ...baseArgs,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=3",
        spec.destination,
        remoteCommand,
      ],
      localDir,
    );
    if (copyCode !== 0) {
      throw new Error(
        `ssh file download failed (exit ${copyCode}): ${stderr.trim() || remoteRef}`,
      );
    }
    return join(localDir, basename(remotePath));
  };

  const close = (): void => {
    try {
      spawnSync(
        "ssh",
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
  };

  return { destination: spec.destination, localPort, downloadRef, close };
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
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

function spawnSsh(
  args: string[],
  capture: "inherit" | "pipe",
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, {
      stdio:
        capture === "inherit"
          ? ["inherit", "inherit", "inherit"]
          : ["ignore", "ignore", "pipe"],
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
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const ssh = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
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
    await new Promise((resolve) => setTimeout(resolve, 100));
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
