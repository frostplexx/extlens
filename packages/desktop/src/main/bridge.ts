/**
 * The bridge: the local half of what the page can ask for.
 *
 * Most methods are the extlens protocol and are forwarded verbatim to the host — this process
 * does not model the corpus, it relays. A handful are *local* methods that only make sense on
 * this machine: launching Chrome for Testing, closing it, reading its state, reading the
 * extension's source off disk for the code explorer. That split is the whole reason a sandboxed
 * page can still drive real browsers: it cannot spawn a process, but the main process can, and it
 * is the same process that already runs the ssh tunnel and the file-ref downloads.
 *
 * Local methods are namespaced `local.*` so a host can never shadow one, and the forwarding path
 * never has to guess which side a method belongs to.
 */
import type { FileRefs } from "@extlens/protocol";
import {
    BrowserManager,
    browserDir,
    ExtlensClient,
    installChrome,
    missingBrowserMessage,
    resolveExecutable,
    type BrowserState,
    type SshManager,
} from "@extlens/session";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { diffSource, readSourceFile, type SourceFile, type SourceTree } from "./source.js";

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
     * pinned it to null forever and every remote launch failed with "tunnel not up". The same goes
     * for `enabled` now that the target can change while the bridge lives.
     */
    ssh: { enabled: () => boolean; manager: () => SshManager | null };
    /** Pushed to the page whenever local state changes. */
    broadcast: (event: string, payload: unknown) => void;
}

/**
 * Local browser state, owned by the main process rather than by the page.
 *
 * The browsers outlive any single page load — a reload, a closed laptop lid — so their state
 * cannot live in the page. The page subscribes and is told; it never holds the truth.
 */
export class Bridge {
    private browsers = new BrowserManager();
    private state: Record<BrowserLabel, BrowserState> = { mv2: { ...IDLE }, mv3: { ...IDLE } };
    /** Missing-browser questions awaiting a yes/no from the page. */
    private prompts: DownloadPrompt[] = [];
    /** File refs of the extension the browsers were last asked to open. */
    private lastFiles: FileRefs | null = null;
    /**
     * Resolved refs per extension. Over ssh, resolving means tarring the remote directory down,
     * and the code explorer asks for the tree and then for one file at a time — without this
     * every click would be a fresh download of the whole extension.
     */
    private resolved = new Map<string, FileRefs>();

    constructor(private deps: BridgeDeps) {}

    /** Everything a freshly attached page needs to render local state. */
    snapshot(): LocalSnapshot {
        return { browsers: this.state, prompts: this.prompts, browserDir: browserDir() };
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
            case "local.browsers.install":
                return this.install(params.label);
            case "local.openUrl":
                return this.openUrl(String(params.url ?? ""));
            case "local.source.tree":
                return this.sourceTree(params.files as FileRefs | null, params.id as string | undefined);
            case "local.source.file":
                return this.sourceFile(
                    params.files as FileRefs | null,
                    params.id as string | undefined,
                    params.label,
                    params.path,
                );
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
        this.lastFiles = await this.resolveCached(files, id);
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
        if (!this.deps.ssh.enabled()) return files;
        const session = this.deps.ssh.manager()?.session;
        if (!session) throw new Error("tunnel not up");
        const resolved: FileRefs = {};
        for (const label of ["mv2", "mv3"] as const) {
            const ref = files[label];
            if (ref) resolved[label] = await session.downloadRef(label, id ?? "extension", ref);
        }
        return resolved;
    }

    private async resolveCached(files: FileRefs, id?: string): Promise<FileRefs> {
        const key = `${id ?? ""}\0${files.mv2 ?? ""}\0${files.mv3 ?? ""}`;
        const hit = this.resolved.get(key);
        if (hit) return hit;
        const resolved = await this.resolve(files, id);
        this.resolved.set(key, resolved);
        return resolved;
    }

    /** The extension's files with an MV2→MV3 status per path, for the code explorer. */
    private async sourceTree(files: FileRefs | null, id?: string): Promise<SourceTree> {
        if (!files) throw new Error("no files for this extension");
        const local = await this.resolveCached(files, id);
        return diffSource(local.mv2 ? refToPath(local.mv2) : undefined, local.mv3 ? refToPath(local.mv3) : undefined);
    }

    private async sourceFile(files: FileRefs | null, id: string | undefined, label: unknown, path: unknown): Promise<SourceFile> {
        if (!files) throw new Error("no files for this extension");
        if (label !== "mv2" && label !== "mv3") throw new Error(`unknown variant: ${String(label)}`);
        if (typeof path !== "string") throw new Error("path must be a string");
        const local = await this.resolveCached(files, id);
        const ref = local[label];
        if (!ref) throw new Error(`no ${label} files for this extension`);
        return readSourceFile(refToPath(ref), path);
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
        const executable = await this.download(prompt.label);
        if (executable) this.launchOne(prompt.label, executable, refToPath(ref));
        return this.snapshot();
    }

    /**
     * Download Chrome for Testing for a label, reporting progress through the browser's own
     * state. Null on failure, with the reason left in that state for the page to show.
     */
    private async download(label: BrowserLabel): Promise<string | null> {
        this.set(label, { phase: "downloading", message: "downloading chrome for testing…", extensionId: null });
        try {
            return await installChrome(label, (pct) =>
                this.set(label, { phase: "downloading", message: `downloading chrome for testing… ${pct}%`, extensionId: null }),
            );
        } catch (error) {
            this.set(label, { phase: "failed", message: error instanceof Error ? error.message : String(error), extensionId: null });
            return null;
        }
    }

    /** Install without launching: the settings page fetching a browser ahead of any review. */
    private async install(label: unknown): Promise<unknown> {
        if (label !== "mv2" && label !== "mv3") throw new Error(`unknown browser: ${String(label)}`);
        const executable = await this.download(label);
        if (executable) this.set(label, { phase: "idle", message: `installed ${executable}`, extensionId: null });
        return this.snapshot();
    }

    /**
     * Open a page in the running test browsers.
     *
     * Only http(s): this method takes a string from the page and hands it to a browser this
     * process controls, so the scheme list is a whitelist rather than a blacklist — file:// would
     * turn the page into a local file reader.
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
