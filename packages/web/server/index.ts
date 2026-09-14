#!/usr/bin/env node
/**
 * The local web server: serves the UI, and is the only thing that talks to the host.
 *
 *   browser tab ──ws──► this process ──ws (or ssh -L)──► extlens host
 *                            └──► playwright ──► Chrome for Testing (MV2 / MV3)
 *
 * Binding is 127.0.0.1 only and every connection must present the token printed at startup. The
 * bridge can spawn browsers and read local files, so it is not something to expose on a LAN, and
 * a token in the URL is the cheapest thing that survives a curious device on the same network.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { ExtlensClient, createSshManager, parseSshSpec, type SshManager, type TunnelStatus } from "@extlens/session";
import type { ConnectionStatus } from "@extlens/session";
import { Bridge } from "./bridge.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "..", "dist");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
};

function flag(argv: string[], name: string): string | null {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

/** Serve one file from dist, refusing anything that escapes it. */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const urlPath = (req.url ?? "/").split("?")[0];
    const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
    const file = join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file)) {
        // Unknown paths fall back to index.html: the UI is a single page, and a refresh on any
        // route must not 404.
        const index = join(DIST, "index.html");
        if (!existsSync(index)) {
            res.writeHead(503, { "content-type": "text/plain" });
            res.end("UI not built yet — run `npm run build --workspace packages/web`");
            return;
        }
        res.writeHead(200, { "content-type": MIME[".html"] });
        res.end(await readFile(index));
        return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
}

/**
 * Arguments as the script actually receives them.
 *
 * A literal `--` can survive the npm chain when one is typed by hand (`npm run web -- -- --ssh
 * host`), which is a natural thing to type and used to be necessary. It is a separator, never a
 * flag, so drop it rather than letting it become a positional argument some future parser trips on.
 */
function scriptArgs(argv: string[]): string[] {
    return argv.filter((arg) => arg !== "--");
}

async function main(): Promise<void> {
    const argv = scriptArgs(process.argv.slice(2));
    const port = Number(flag(argv, "port") ?? process.env.EXTLENS_WEB_PORT ?? 8090);
    const wsUrl = flag(argv, "ws") ?? process.env.EXTLENS_WS ?? "ws://localhost:8081";
    const sshSpec = parseSshSpec(argv);
    const token = process.env.EXTLENS_WEB_TOKEN ?? randomBytes(16).toString("hex");

    let client: ExtlensClient | null = null;
    let connection: ConnectionStatus = "connecting";
    let connectionMessage: string | null = null;
    let tunnel: TunnelStatus | null = sshSpec ? "connecting" : null;
    let sshManager: SshManager | null = null;
    const sockets = new Set<WebSocket>();

    const broadcast = (event: string, payload: unknown): void => {
        const frame = JSON.stringify({ event, payload });
        for (const socket of sockets) {
            if (socket.readyState === socket.OPEN) socket.send(frame);
        }
    };

    const sessionState = () => ({ connection, message: connectionMessage, tunnel, ssh: sshSpec?.destination ?? null });

    const onStatus = (next: ConnectionStatus, message?: string): void => {
        connection = next;
        connectionMessage = message ?? null;
        broadcast("session", sessionState());
    };

    const bridge = new Bridge({
        client: () => client,
        ssh: { enabled: sshSpec !== null, manager: () => sshManager },
        broadcast,
    });

    if (sshSpec) {
        // A password prompt has to happen on this terminal: the tab may not exist yet, and the
        // tunnel must be up before the UI has anything to show.
        sshManager = createSshManager({
            spec: sshSpec,
            getSecret: async () => {
                process.stdout.write(`password for ${sshSpec.destination}: `);
                return await new Promise<string>((done) => {
                    process.stdin.setEncoding("utf8");
                    process.stdin.once("data", (d) => done(String(d).trim()));
                });
            },
            onStatus: (next, message) => {
                tunnel = next;
                if (next === "failed" && message) connectionMessage = message;
                broadcast("session", sessionState());
                if (next === "up" && !client) {
                    const local = sshManager?.localPort;
                    if (local) {
                        client = new ExtlensClient(`ws://127.0.0.1:${local}`, onStatus);
                        client.start();
                    }
                }
            },
        });
        sshManager.start();
    } else {
        client = new ExtlensClient(wsUrl, onStatus);
        client.start();
    }

    const server = createServer((req, res) => void serveStatic(req, res));
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/bridge" || url.searchParams.get("token") !== token) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });

    wss.on("connection", (socket) => {
        sockets.add(socket);
        socket.send(JSON.stringify({ event: "session", payload: sessionState() }));
        socket.send(JSON.stringify({ event: "local.browsers", payload: bridge.snapshot() }));

        socket.on("close", () => sockets.delete(socket));
        socket.on("message", (raw) => {
            void (async () => {
                let id: unknown = null;
                try {
                    const msg = JSON.parse(String(raw)) as { id: unknown; method: string; params?: Record<string, unknown> };
                    id = msg.id;
                    const params = msg.params ?? {};
                    // Local methods stay here; everything else is the host's protocol, relayed.
                    const result = msg.method.startsWith("local.")
                        ? await bridge.handle(msg.method, params)
                        : await (() => {
                              if (!client) throw new Error("not connected to a host");
                              return client.call(msg.method, params);
                          })();
                    socket.send(JSON.stringify({ id, result }));
                } catch (error) {
                    socket.send(JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) }));
                }
            })();
        });
    });

    // A port conflict is the most likely startup failure (a second copy of this server, or the
    // ink client's dev port). Say so in one line instead of letting node throw a stack trace.
    server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
            process.stderr.write(`port ${port} is already in use — pass --port to pick another\n`);
            process.exit(1);
        }
        throw error;
    });

    server.listen(port, "127.0.0.1", () => {
        const url = `http://127.0.0.1:${port}/?token=${token}`;
        process.stdout.write(`\nextlens web — ${url}\n`);
        process.stdout.write(`host: ${sshSpec ? `ssh ${sshSpec.destination}` : wsUrl}\n\n`);
    });

    const shutdown = (): void => {
        void bridge.dispose().finally(() => {
            sshManager?.stop();
            client?.stop();
            server.close();
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

void main();
