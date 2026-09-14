/**
 * The bridge: one WebSocket the browser tab talks to, two things behind it.
 *
 * Most methods are the extlens protocol and are forwarded verbatim to the host — the server does
 * not model the corpus, it relays. A handful are *local* methods that only make sense on this
 * machine: launching Chrome for Testing, closing it, reading its state. That split is the whole
 * reason a web UI can still drive real browsers. The page cannot spawn a process, but the process
 * serving the page can, and it is the same process that already runs the ssh tunnel and the
 * file-ref downloads for the terminal client.
 *
 * Local methods are namespaced `local.*` so a host can never shadow one, and the forwarding path
 * never has to guess which side a method belongs to.
 */
import type { FileRefs } from "@extlens/protocol";
import {
    BrowserManager,
    BROWSER_DIR,
    ExtlensClient,
    installChrome,
    missingBrowserMessage,
    resolveExecutable,
    type BrowserState,
    type SshManager,
} from "@extlens/session";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type BrowserLabel = "mv2" | "mv3";

const IDLE: BrowserState = { phase: "idle", message: null, extensionId: null };

/** A protocol file ref as a local extension directory. */
export function refToPath(ref: string): string {
    const path = ref.startsWith("file://") ? fileURLToPath(ref) : ref;
    return path.endsWith("manifest.json") ? dirname(path) : path;
}

export interface DownloadPrompt {
    label: BrowserLabel;
    message: string;
}

/** Local state a tab renders: what the browsers are doing, and any pending download question. */
export interface LocalSnapshot {
    browsers: Record<BrowserLabel, BrowserState>;
    prompts: DownloadPrompt[];
    /** Where a downloaded Chrome for Testing would be installed, for the prompt's wording. */
    browserDir: string;
}

export interface BridgeDeps {
    client: () => ExtlensClient | null;
    /**
     * The ssh manager is read through a function, not held as a value: it is created after the
     * bridge (the tunnel needs somewhere to report status to), so capturing it at construction
     * pinned it to null forever and every remote launch failed with "tunnel not up".
     */
    ssh: { enabled: boolean; manager: () => SshManager | null };
    /** Pushed to every connected tab whenever local state changes. */
    broadcast: (event: string, payload: unknown) => void;
}

/**
 * Local browser state, owned by the server rather than by a tab.
 *
 * The browsers outlive any single page load — a reload, a second tab, a closed laptop lid — so
 * their state cannot live in the page. Tabs subscribe and are told; they never hold the truth.
 */
export class Bridge {
    private browsers = new BrowserManager();
    private state: Record<BrowserLabel, BrowserState> = { mv2: { ...IDLE }, mv3: { ...IDLE } };
    /** Missing-browser questions awaiting a yes/no from some tab. */
    private prompts: DownloadPrompt[] = [];
    /** File refs of the extension the browsers were last asked to open. */
    private lastFiles: FileRefs | null = null;

    constructor(private deps: BridgeDeps) {}

    /** Everything a freshly connected tab needs to render local state. */
    snapshot(): LocalSnapshot {
        return { browsers: this.state, prompts: this.prompts, browserDir: BROWSER_DIR };
    }

    async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
        switch (method) {
            case "local.status":
                return this.snapshot();
            case "local.launch":
                return this.launch(params.files as FileRefs | null, params.id as string | undefined);
            case "local.close":
                return this.closeAll();
            case "local.answerPrompt":
                return this.answerPrompt(Boolean(params.accept));
            case "local.openUrl":
                return this.openUrl(String(params.url ?? ""));
            default:
                throw new Error(`unknown local method: ${method}`);
        }
    }

    private set(label: BrowserLabel, next: BrowserState): void {
        this.state = { ...this.state, [label]: next };
        this.deps.broadcast("local.browsers", this.snapshot());
    }

    private async launch(files: FileRefs | null, id?: string): Promise<unknown> {
        if (!files) return this.snapshot();
        this.lastFiles = await this.resolve(files, id);
        await this.browsers.closeAll();
        this.state = { mv2: { ...IDLE }, mv3: { ...IDLE } };
        this.prompts = [];
        for (const label of ["mv2", "mv3"] as const) {
            const ref = this.lastFiles[label];
            if (!ref) continue;
            const executable = resolveExecutable(label);
            // A ~150MB download is a question, not something to do behind the user's back.
            if (!executable) {
                this.prompts.push({ label, message: missingBrowserMessage(label) });
                continue;
            }
            this.launchOne(label, executable, refToPath(ref));
        }
        this.deps.broadcast("local.browsers", this.snapshot());
        return this.snapshot();
    }

    /**
     * Remote host: the browsers run here, so the extension files have to be here too. Downloading
     * through the existing ssh session is what makes a remote corpus reviewable on a local screen.
     */
    private async resolve(files: FileRefs, id?: string): Promise<FileRefs> {
        if (!this.deps.ssh.enabled) return files;
        const session = this.deps.ssh.manager()?.session;
        if (!session) throw new Error("tunnel not up");
        const resolved: FileRefs = {};
        for (const label of ["mv2", "mv3"] as const) {
            const ref = files[label];
            if (ref) resolved[label] = await session.downloadRef(label, id ?? "extension", ref);
        }
        return resolved;
    }

    private launchOne(label: BrowserLabel, executable: string, extensionPath: string): void {
        void this.browsers.launch({ label, executable, extensionPath }, IDLE, (next) => this.set(label, next));
    }

    private async closeAll(): Promise<unknown> {
        await this.browsers.closeAll();
        const closed: BrowserState = { phase: "closed", message: "closed", extensionId: null };
        this.state = { mv2: closed, mv3: closed };
        this.deps.broadcast("local.browsers", this.snapshot());
        return this.snapshot();
    }

    private async answerPrompt(accept: boolean): Promise<unknown> {
        const prompt = this.prompts.shift();
        if (!prompt) return this.snapshot();
        const ref = this.lastFiles?.[prompt.label];
        if (!accept || !ref) {
            this.set(prompt.label, { phase: "failed", message: prompt.message, extensionId: null });
            return this.snapshot();
        }
        this.set(prompt.label, { phase: "downloading", message: "downloading chrome for testing…", extensionId: null });
        try {
            const executable = await installChrome(prompt.label, (pct) =>
                this.set(prompt.label, {
                    phase: "downloading",
                    message: `downloading chrome for testing… ${pct}%`,
                    extensionId: null,
                }),
            );
            this.launchOne(prompt.label, executable, refToPath(ref));
        } catch (error) {
            this.set(prompt.label, {
                phase: "failed",
                message: error instanceof Error ? error.message : String(error),
                extensionId: null,
            });
        }
        return this.snapshot();
    }

    /**
     * Open a page in the running test browsers.
     *
     * Only http(s): this method takes a string from a web page and hands it to a browser the
     * server controls, so the scheme list is a whitelist rather than a blacklist — file:// would
     * turn a page into a local file reader.
     */
    private async openUrl(url: string): Promise<unknown> {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`not a URL: ${url}`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`refusing to open ${parsed.protocol} — only http and https`);
        }
        if (this.browsers.activeCount === 0) {
            throw new Error("no test browser is running — launch them first");
        }
        const results = await this.browsers.openUrl(parsed.toString());
        const failed = results.filter((r) => !r.ok);
        if (failed.length === results.length) {
            throw new Error(`could not open ${parsed.hostname}: ${failed[0]?.error ?? "unknown error"}`);
        }
        return { opened: results.filter((r) => r.ok).map((r) => r.label), failed };
    }

    /** Kill every browser this process started. Called on shutdown. */
    async dispose(): Promise<void> {
        await this.browsers.closeAll();
    }
}
