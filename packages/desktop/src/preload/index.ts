/**
 * The renderer's whole view of the main process: two functions and the platform name.
 *
 * `call` is one RPC; `on` subscribes to pushed events. The page's IpcBridge (src/renderer/bridge.ts)
 * wraps these and nothing else in the renderer touches `window.extlens`. The surface is kept this
 * small because everything behind it can spawn browsers and read files — the page gets a method
 * name and a JSON payload, never a capability.
 */
import { contextBridge, ipcRenderer } from "electron";

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

contextBridge.exposeInMainWorld("extlens", {
    /** Which window chrome the page is under: macOS puts traffic lights in the top bar's left. */
    platform: process.platform,
    async call(method: string, params: Record<string, unknown>): Promise<unknown> {
        // Errors cross IPC as data so the message survives intact; Electron's own rethrow
        // prefixes it with the channel name, which the UI would then show to the user.
        const reply = (await ipcRenderer.invoke("extlens:call", method, params)) as Reply;
        if (!reply.ok) throw new Error(reply.error);
        return reply.result;
    },
    on(event: string, handler: (payload: unknown) => void): () => void {
        const listener = (_: unknown, name: string, payload: unknown): void => {
            if (name === event) handler(payload);
        };
        ipcRenderer.on("extlens:event", listener);
        return () => ipcRenderer.removeListener("extlens:event", listener);
    },
});
