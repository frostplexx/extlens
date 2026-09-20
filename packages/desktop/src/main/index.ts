/**
 * The Electron main process: the one process that talks to the host and owns the test browsers.
 *
 *   renderer ──ipc──► this process ──ws (or ssh -L)──► extlens host
 *                          └──► playwright ──► Chrome for Testing (MV2 / MV3)
 *
 * This file is transport and window management only. What the process *does* — the host
 * connection, the tunnel, the browsers, the password flow — is the core (core.ts). IPC here is
 * one channel in and one channel out, and only our own window may use either.
 */
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from "electron";
import { DEFAULT_WS_URL, createCore, parseTarget, targetFromArgs, type Core, type HostTarget } from "./core.js";
import { createCredentialStore } from "./credentials.js";
import { createSettingsStore } from "./settings.js";
import { ORIGIN, SCHEME, serve } from "./static.js";

const RENDERER_DIST = join(__dirname, "..", "renderer");
const PRELOAD = join(__dirname, "..", "preload", "index.js");
/** Set by `npm run dev`: load the page from vite instead of dist, for HMR. */
const DEV_URL = process.env.ELECTRON_RENDERER_URL ?? null;

/** Where the app was last pointed, so the next launch goes to the same host. No secrets here. */
const connectionFile = (): string => join(app.getPath("userData"), "connection.json");
const credentialsFile = (): string => join(app.getPath("userData"), "credentials.json");
const settingsFile = (): string => join(app.getPath("userData"), "settings.json");

/** Catppuccin Mocha base and text, matching the renderer's theme. */
const THEME = { background: "#1e1e2e", foreground: "#cdd6f4" };
/** The renderer's top bar, which doubles as the title bar. Matches TopBar's height. */
const TITLE_BAR_HEIGHT = 44;

async function savedTarget(): Promise<HostTarget | null> {
    try {
        return parseTarget(JSON.parse(await readFile(connectionFile(), "utf8")));
    } catch {
        return null;
    }
}

/**
 * Flags as the process receives them. A packaged app has no script argument, and a literal `--`
 * can survive an npm chain when typed by hand; neither is a flag.
 */
function scriptArgs(): string[] {
    return process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => arg !== "--");
}

/** A native open dialog, for the settings page. Null when dismissed. */
async function pick(parent: BrowserWindow | null, directory: boolean, args: Record<string, unknown>): Promise<{ path: string | null }> {
    const options: Electron.OpenDialogOptions = {
        title: typeof args.title === "string" ? args.title : undefined,
        defaultPath: typeof args.defaultPath === "string" ? args.defaultPath : undefined,
        // A macOS browser is an .app bundle with the executable inside; treating it as a folder
        // lets the picker reach it.
        properties: directory ? ["openDirectory", "createDirectory"] : ["openFile", "treatPackageAsDirectory"],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
}

/**
 * Write the export files into a folder the user picks, and reveal them.
 *
 * Not `<a download>` from the renderer: Chromium lets a page start one download without a user
 * gesture and silently drops the rest, and the click's activation is gone by the time the reports
 * have been fetched — so only the first of the two files ever arrived, and it landed in whatever
 * the default download directory was without saying so. Null when the picker is dismissed.
 */
async function saveExports(
    parent: BrowserWindow | null,
    args: Record<string, unknown>,
): Promise<{ dir: string | null; files: string[] }> {
    const files = Array.isArray(args.files) ? args.files : [];
    const options: Electron.OpenDialogOptions = {
        title: "Save exported reports",
        buttonLabel: "Save here",
        defaultPath: app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const dir = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!dir) return { dir: null, files: [] };
    const written: string[] = [];
    for (const file of files) {
        if (!file || typeof file !== "object") continue;
        const { name, content } = file as { name?: unknown; content?: unknown };
        if (typeof name !== "string" || typeof content !== "string") continue;
        // The renderer names the files; the folder is the only thing the user chose.
        const path = join(dir, name.replace(/[\\/]/g, "_"));
        await writeFile(path, content, "utf8");
        written.push(path);
    }
    if (written[0]) shell.showItemInFolder(written[0]);
    return { dir, files: written };
}

/** Only our own page may call in: the renderer's origin, or vite's in development. */
function trustedUrl(url: string): boolean {
    return url.startsWith(`${ORIGIN}/`) || (DEV_URL !== null && url.startsWith(DEV_URL));
}

// A second copy would spawn a second set of browsers over the same corpus.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    protocol.registerSchemesAsPrivileged([
        { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ]);
    void main();
}

async function main(): Promise<void> {
    await app.whenReady();
    protocol.handle(SCHEME, (request) => serve(request, RENDERER_DIST));

    let window: BrowserWindow | null = null;
    const emit = (event: string, payload: unknown): void => {
        if (window && !window.isDestroyed()) window.webContents.send("extlens:event", event, payload);
    };

    const core: Core = createCore({
        emit,
        credentials: createCredentialStore(credentialsFile()) ?? undefined,
        settings: createSettingsStore(settingsFile()),
        onTarget: (target) => {
            void writeFile(connectionFile(), JSON.stringify(target, null, 2)).catch(() => {});
        },
    });

    ipcMain.handle("extlens:call", async (event, method: unknown, params: unknown) => {
        if (!event.senderFrame || !trustedUrl(event.senderFrame.url)) return { ok: false, error: "untrusted caller" };
        if (typeof method !== "string") return { ok: false, error: "method must be a string" };
        const args = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
        try {
            // Native pickers are the window's, not the core's: they need Electron and a parent.
            if (method === "local.app.pickFile" || method === "local.app.pickDirectory") {
                return { ok: true, result: await pick(window, method === "local.app.pickDirectory", args) };
            }
            if (method === "local.app.saveExports") {
                return { ok: true, result: await saveExports(window, args) };
            }
            return { ok: true, result: await core.handle(method, args) };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    /*
     * No native title bar: the renderer's top bar is the title bar. On macOS the traffic lights
     * are placed inside it and it is a drag region; elsewhere the window controls are drawn by
     * the OS as an overlay in our colours, at the same height.
     */
    window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        title: "extlens",
        backgroundColor: THEME.background,
        show: false,
        titleBarStyle: "hidden",
        ...(process.platform === "darwin"
            ? { trafficLightPosition: { x: 16, y: (TITLE_BAR_HEIGHT - 12) / 2 } }
            : { titleBarOverlay: { color: THEME.background, symbolColor: THEME.foreground, height: TITLE_BAR_HEIGHT } }),
        webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.once("ready-to-show", () => window?.show());
    window.on("closed", () => {
        window = null;
    });

    // Links open in the user's browser, never in a new window of ours; and the page never leaves
    // its own origin.
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (!trustedUrl(url)) event.preventDefault();
    });
    if (!app.isPackaged) {
        // Renderer errors on the terminal that launched us, where a developer is looking.
        window.webContents.on("console-message", (details) => {
            if (details.level === "error") process.stderr.write(`[renderer] ${details.message}\n`);
        });
    }

    app.on("second-instance", () => {
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.focus();
    });

    if (DEV_URL) await window.loadURL(DEV_URL);
    else await window.loadURL(`${ORIGIN}/index.html`);

    // Flags win over what was saved, and both over the default; the dialog can change it later.
    const target = targetFromArgs(scriptArgs()) ?? (await savedTarget()) ?? { kind: "ws" as const, url: DEFAULT_WS_URL };
    void core.connect({ target });

    // Every browser this process started dies with it; asking to quit waits for that.
    let disposed = false;
    app.on("will-quit", (event) => {
        if (disposed) return;
        event.preventDefault();
        void core.dispose().finally(() => {
            disposed = true;
            app.quit();
        });
    });
    app.on("window-all-closed", () => app.quit());
}
