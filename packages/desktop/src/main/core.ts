/**
 * The core of the local process, independent of how a UI reaches it.
 *
 * The Electron main process (index.ts) fronts this object over IPC and does three things with it —
 * hands method calls in, forwards pushed events, and stops it — so everything else lives here: the
 * connection to the host (direct or through an ssh tunnel), the local browsers via the Bridge, and
 * the ssh password flow. Tests drive it the same way, with no Electron in sight.
 *
 * Methods a UI calls fall in three namespaces:
 *   - `local.session.*`  — owned here: which host to talk to, and the answer to a password prompt.
 *   - `local.settings.*` — owned here: what the user configured, applied to the session package.
 *   - `local.browsers.status` — which executables the browsers would use right now, and why.
 *   - `local.replay`     — re-emit the current state, for a page that has just attached.
 *   - other `local.*`   — the Bridge: browsers and source files on this machine.
 *   - everything else   — the extlens protocol, relayed to the host untouched.
 */
import {
    ExtlensClient,
    browserConfig,
    createSshManager,
    resolveExecutableDetailed,
    setBrowserConfig,
    type ResolvedExecutable,
    type SshManager,
    type SshSpec,
    type TunnelStatus,
} from "@extlens/session";
import type { ConnectionStatus } from "@extlens/session";
import { Bridge } from "./bridge.js";
import { EMPTY_SETTINGS, parseSettings, type Settings, type SettingsStore } from "./settings.js";

/** Where the host is: a WebSocket on this machine, or one behind an ssh tunnel. */
export type HostTarget = { kind: "ws"; url: string } | { kind: "ssh"; destination: string; remotePort: number };

export const DEFAULT_WS_URL = "ws://localhost:8081";
export const DEFAULT_REMOTE_PORT = 8081;

/** An ssh password the tunnel is waiting on. Answered with `local.session.secret`. */
export interface SecretPrompt {
    id: number;
    destination: string;
    /** True when a previous answer (typed or saved) was rejected, so the dialog can say so. */
    retry: boolean;
}

/** The UI's answer to a prompt. */
interface PromptReply {
    secret: string;
    remember: boolean;
}

/** What the page renders about the host connection. Mirrored in src/renderer/types.ts. */
export interface SessionState {
    connection: ConnectionStatus;
    message: string | null;
    tunnel: TunnelStatus | null;
    /** The ssh destination when the target is a tunnel; kept for older readers of this shape. */
    ssh: string | null;
    target: HostTarget | null;
    /** Whether `remember` on a connect will actually be honoured (a keychain is available). */
    canRemember: boolean;
    prompt: SecretPrompt | null;
}

/**
 * Where remembered ssh secrets go. Supplied by a transport that has somewhere safe to put them
 * (Electron: the OS keychain via safeStorage); absent otherwise, in which case nothing is stored and
 * the UI is told so through `canRemember`.
 */
export interface CredentialStore {
    load(destination: string): Promise<string | null>;
    save(destination: string, secret: string): Promise<void>;
    forget(destination: string): Promise<void>;
    /** Every destination with a saved secret. Never the secrets themselves. */
    list(): Promise<string[]>;
}

/** What the settings page shows about each test browser. Mirrored in src/renderer/types.ts. */
export interface BrowsersStatus {
    /** Where downloads go: the setting, or the environment/default underneath it. */
    dir: { configured: string | null; effective: string };
    mv2: { configured: string | null; resolved: ResolvedExecutable | null };
    mv3: { configured: string | null; resolved: ResolvedExecutable | null };
}

export interface CoreOptions {
    /** Pushed to every attached UI whenever state changes. */
    emit: (event: string, payload: unknown) => void;
    credentials?: CredentialStore;
    /** Persisted settings; without one, nothing is configurable and the environment rules. */
    settings?: SettingsStore;
    /**
     * Where a password comes from when nothing is saved and the UI has not supplied one. Unset,
     * the UI is prompted through `prompt` in the session state; a test can answer directly.
     */
    getSecret?: (destination: string) => Promise<string>;
    /** Called after every successful connect with the target, for a transport that persists it. */
    onTarget?: (target: HostTarget) => void;
}

export interface ConnectParams {
    target: HostTarget;
    /** A password for the first prompt, when the UI collected one up front. */
    secret?: string;
    /** Save the secret once the tunnel is up. Ignored without a credential store. */
    remember?: boolean;
}

export interface Core {
    handle(method: string, params: Record<string, unknown>): Promise<unknown>;
    connect(params: ConnectParams): Promise<SessionState>;
    disconnect(): Promise<SessionState>;
    sessionState(): SessionState;
    /** Everything a freshly attached UI needs, as the events it would otherwise have missed. */
    initialEvents(): { event: string; payload: unknown }[];
    dispose(): Promise<void>;
}

/** `--ws`, `--ssh`, `--remote-port` and their env vars, as a target. Null when none is given. */
export function targetFromArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): HostTarget | null {
    const flag = (name: string): string | null => {
        const i = argv.indexOf(`--${name}`);
        return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
    };
    // EXLENS_* (missing T) was the original spelling and is what every existing shell profile
    // sets; EXTLENS_* is what the docs have always said. Both work, documented one wins.
    const destination = flag("ssh") ?? env.EXTLENS_SSH ?? env.EXLENS_SSH ?? null;
    if (destination) {
        const raw = flag("remote-port") ?? env.EXTLENS_REMOTE_PORT ?? env.EXLENS_REMOTE_PORT;
        const remotePort = raw ? Number(raw) : DEFAULT_REMOTE_PORT;
        if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
            throw new Error(`invalid remote port: ${raw}`);
        }
        return { kind: "ssh", destination, remotePort };
    }
    const url = flag("ws") ?? env.EXTLENS_WS ?? null;
    return url ? { kind: "ws", url } : null;
}

/** A target from untrusted UI input. Throws on anything malformed rather than connecting to it. */
export function parseTarget(raw: unknown): HostTarget {
    const t = (raw ?? {}) as Record<string, unknown>;
    if (t.kind === "ws") {
        const url = typeof t.url === "string" ? t.url.trim() : "";
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`not a URL: ${url || "(empty)"}`);
        }
        if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") throw new Error(`not a WebSocket URL: ${url}`);
        return { kind: "ws", url };
    }
    if (t.kind === "ssh") {
        const destination = typeof t.destination === "string" ? t.destination.trim() : "";
        // The destination becomes an ssh argument; refuse anything that could read as an option.
        if (!destination || destination.startsWith("-") || /\s/.test(destination)) {
            throw new Error(`not an ssh destination: ${destination || "(empty)"}`);
        }
        const remotePort = t.remotePort === undefined || t.remotePort === "" ? DEFAULT_REMOTE_PORT : Number(t.remotePort);
        if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
            throw new Error(`invalid remote port: ${String(t.remotePort)}`);
        }
        return { kind: "ssh", destination, remotePort };
    }
    throw new Error(`unknown target kind: ${String(t.kind)}`);
}

export function createCore(options: CoreOptions): Core {
    /**
     * What the environment gave the session package before any setting was applied. A cleared
     * setting falls back to this, so "unset" means the same thing it does on the command line.
     */
    const envBrowsers = browserConfig();
    let settings: Settings = EMPTY_SETTINGS;

    const applySettings = (next: Settings): void => {
        settings = next;
        setBrowserConfig({
            dir: next.browsers.dir ?? envBrowsers.dir,
            executables: {
                mv2: next.browsers.mv2 ?? envBrowsers.executables.mv2,
                mv3: next.browsers.mv3 ?? envBrowsers.executables.mv3,
            },
        });
    };
    const settingsLoaded: Promise<void> = options.settings
        ? options.settings.load().then(applySettings, () => {})
        : Promise.resolve();

    const browsersStatus = (): BrowsersStatus => ({
        dir: { configured: settings.browsers.dir, effective: browserConfig().dir },
        mv2: { configured: settings.browsers.mv2, resolved: resolveExecutableDetailed("mv2") },
        mv3: { configured: settings.browsers.mv3, resolved: resolveExecutableDetailed("mv3") },
    });

    let client: ExtlensClient | null = null;
    let sshManager: SshManager | null = null;
    let target: HostTarget | null = null;
    let connection: ConnectionStatus = "disconnected";
    let connectionMessage: string | null = null;
    let tunnel: TunnelStatus | null = null;
    let prompt: SecretPrompt | null = null;
    /** Resolves the outstanding prompt; null when nothing is waiting. */
    let answer: ((reply: PromptReply) => void) | null = null;
    let nextPromptId = 1;
    /**
     * Each connect gets a generation. A status callback from a client or tunnel that has since
     * been replaced must not overwrite the state of the one that replaced it.
     */
    let generation = 0;

    const sessionState = (): SessionState => ({
        connection,
        message: connectionMessage,
        tunnel,
        ssh: target?.kind === "ssh" ? target.destination : null,
        target,
        canRemember: options.credentials !== undefined,
        prompt,
    });

    const publish = (): void => options.emit("session", sessionState());

    const bridge = new Bridge({
        client: () => client,
        ssh: { enabled: () => target?.kind === "ssh", manager: () => sshManager },
        broadcast: options.emit,
    });

    /**
     * Ask the attached UI for a password and wait for `local.session.secret`. A tunnel that has
     * been replaced gets a cancel straight back rather than a dialog for a host nobody wants.
     */
    const promptUi = (destination: string, retry: boolean, gen: number): Promise<PromptReply> =>
        new Promise<PromptReply>((resolve) => {
            if (gen !== generation) {
                resolve({ secret: "", remember: false });
                return;
            }
            prompt = { id: nextPromptId++, destination, retry };
            answer = (reply) => {
                prompt = null;
                answer = null;
                resolve(reply);
            };
            publish();
        });

    /** Cancel an outstanding prompt: the tunnel sees "" and reports auth cancelled. */
    const dropPrompt = (): void => {
        answer?.({ secret: "", remember: false });
    };

    const stopCurrent = async (): Promise<void> => {
        generation += 1;
        dropPrompt();
        sshManager?.stop();
        sshManager = null;
        client?.stop();
        client = null;
        tunnel = null;
    };

    const startClient = (url: string, gen: number): void => {
        client = new ExtlensClient(url, (next, message) => {
            if (gen !== generation) return;
            connection = next;
            connectionMessage = message ?? null;
            publish();
        });
        client.start();
    };

    const connectSsh = (spec: SshSpec, params: ConnectParams, gen: number): void => {
        const { destination } = spec;
        /**
         * Where each password attempt comes from, in order: the one the UI typed into the connect
         * dialog, then the saved one, then a prompt. The tunnel asks up to three times per
         * establish and asks again on every reconnect, so "already tried" is reset when the tunnel
         * comes up — a saved password that worked once should work again without a dialog.
         */
        let typed = params.secret ?? null;
        let triedSaved = false;
        let lastAnswered: string | null = null;
        /**
         * A secret is saved only once the tunnel comes up with it: a wrong password must never
         * land in the keychain. Whether to save is the UI's most recent word — the connect
         * dialog's checkbox, or the prompt's.
         */
        let rememberPending = false;
        const canRemember = options.credentials !== undefined;

        const getSecret = async (): Promise<string> => {
            if (typed !== null) {
                const secret = typed;
                typed = null;
                lastAnswered = secret;
                rememberPending = canRemember && params.remember === true;
                return secret;
            }
            if (!triedSaved && canRemember) {
                triedSaved = true;
                const saved = await options.credentials!.load(destination);
                if (gen !== generation) return "";
                if (saved !== null) {
                    lastAnswered = saved;
                    rememberPending = false;
                    return saved;
                }
            }
            const reply = options.getSecret
                ? { secret: await options.getSecret(destination), remember: false }
                : await promptUi(destination, lastAnswered !== null, gen);
            lastAnswered = reply.secret;
            rememberPending = canRemember && reply.remember && reply.secret !== "";
            return reply.secret;
        };

        sshManager = createSshManager({
            spec,
            getSecret,
            onStatus: (next, message) => {
                if (gen !== generation) return;
                tunnel = next;
                if (next === "failed" && message) connectionMessage = message;
                if (next === "up") {
                    triedSaved = false;
                    if (rememberPending && lastAnswered) {
                        rememberPending = false;
                        void options.credentials?.save(destination, lastAnswered);
                    }
                    if (!client) {
                        const local = sshManager?.localPort;
                        if (local) startClient(`ws://127.0.0.1:${local}`, gen);
                    }
                }
                publish();
            },
        });
        sshManager.start();
    };

    const connect = async (params: ConnectParams): Promise<SessionState> => {
        await stopCurrent();
        const gen = generation;
        target = params.target;
        connection = "connecting";
        connectionMessage = null;
        tunnel = params.target.kind === "ssh" ? "connecting" : null;
        options.onTarget?.(params.target);
        publish();
        if (params.target.kind === "ssh") {
            connectSsh({ destination: params.target.destination, remotePort: params.target.remotePort }, params, gen);
        } else {
            startClient(params.target.url, gen);
        }
        return sessionState();
    };

    const disconnect = async (): Promise<SessionState> => {
        await stopCurrent();
        target = null;
        connection = "disconnected";
        connectionMessage = null;
        publish();
        return sessionState();
    };

    const handleSession = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        switch (method) {
            case "local.session.get":
                return sessionState();
            case "local.session.connect":
                return connect({
                    target: parseTarget(params.target),
                    secret: typeof params.secret === "string" && params.secret !== "" ? params.secret : undefined,
                    remember: params.remember === true,
                });
            case "local.session.disconnect":
                return disconnect();
            case "local.session.secret": {
                // An answer to a prompt that is no longer open is ignored, not applied to the next.
                if (prompt && params.id === prompt.id) {
                    answer?.({
                        secret: typeof params.secret === "string" ? params.secret : "",
                        remember: params.remember === true,
                    });
                }
                return sessionState();
            }
            case "local.session.hasSecret": {
                if (!options.credentials || typeof params.destination !== "string") return { saved: false };
                return { saved: (await options.credentials.load(params.destination)) !== null };
            }
            case "local.session.forget": {
                if (options.credentials && typeof params.destination === "string") {
                    await options.credentials.forget(params.destination);
                }
                return { saved: false };
            }
            case "local.session.saved":
                return { destinations: options.credentials ? await options.credentials.list() : [] };
            default:
                throw new Error(`unknown session method: ${method}`);
        }
    };

    const initialEvents = (): { event: string; payload: unknown }[] => [
        { event: "session", payload: sessionState() },
        { event: "local.browsers", payload: bridge.snapshot() },
    ];

    const handleSettings = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        await settingsLoaded;
        switch (method) {
            case "local.settings.get":
                return { settings, configurable: options.settings !== undefined };
            case "local.settings.set": {
                if (!options.settings) throw new Error("settings are not configurable here");
                const next = parseSettings(params.settings);
                await options.settings.save(next);
                applySettings(next);
                // Browser dir moved: the snapshot's browserDir is stale until something else changes.
                options.emit("local.browsers", bridge.snapshot());
                return { settings, configurable: true };
            }
            default:
                throw new Error(`unknown settings method: ${method}`);
        }
    };

    return {
        async handle(method, params) {
            if (method.startsWith("local.session.")) return handleSession(method, params);
            if (method.startsWith("local.settings.")) return handleSettings(method, params);
            if (method === "local.browsers.status") {
                await settingsLoaded;
                return browsersStatus();
            }
            if (method === "local.replay") {
                for (const { event, payload } of initialEvents()) options.emit(event, payload);
                return null;
            }
            if (method.startsWith("local.")) {
                // Launches read the browser config; a page that raced the settings file must not
                // see the environment's answer.
                await settingsLoaded;
                return bridge.handle(method, params);
            }
            if (!client) throw new Error("not connected to a host");
            return client.call(method, params);
        },
        connect,
        disconnect,
        sessionState,
        initialEvents,
        async dispose() {
            await bridge.dispose();
            await stopCurrent();
        },
    };
}
