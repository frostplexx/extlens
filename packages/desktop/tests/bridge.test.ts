/**
 * The bridge is the piece that makes a web UI able to drive real browsers, so the properties
 * worth pinning are the ones that keep that from becoming a liability: local methods are a closed
 * set, and file refs resolve to a directory Chrome can actually load.
 */
import { describe, expect, it, vi } from "vitest";
import { Bridge, refToPath } from "../src/main/bridge.js";

function makeBridge() {
    const broadcast = vi.fn();
    const bridge = new Bridge({ client: () => null, ssh: { enabled: () => false, manager: () => null }, broadcast });
    return { bridge, broadcast };
}

describe("refToPath", () => {
    it("turns a file:// manifest ref into the extension directory", () => {
        // Chrome loads an unpacked extension by directory; pointing it at manifest.json fails.
        expect(refToPath("file:///tmp/corpus/one-ext/manifest.json")).toBe("/tmp/corpus/one-ext");
    });

    it("accepts a plain path and a directory ref unchanged", () => {
        expect(refToPath("/tmp/corpus/one-ext")).toBe("/tmp/corpus/one-ext");
        expect(refToPath("file:///tmp/corpus/one-ext")).toBe("/tmp/corpus/one-ext");
    });
});

describe("local method routing", () => {
    it("reports idle browsers and no prompts before anything is launched", async () => {
        const { bridge } = makeBridge();
        const snapshot = (await bridge.handle("local.status", {})) as ReturnType<Bridge["snapshot"]>;
        expect(snapshot.browsers.mv2.phase).toBe("idle");
        expect(snapshot.browsers.mv3.phase).toBe("idle");
        expect(snapshot.prompts).toEqual([]);
        expect(snapshot.browserDir.length).toBeGreaterThan(0);
    });

    it("rejects a method it does not own rather than guessing", async () => {
        // The namespace is a closed set on purpose: a host must never be able to reach the
        // process that can spawn browsers by naming a method.
        const { bridge } = makeBridge();
        await expect(bridge.handle("local.exec", {})).rejects.toThrow(/unknown local method/);
    });

    it("is a no-op when asked to launch without file refs", async () => {
        const { bridge, broadcast } = makeBridge();
        const snapshot = (await bridge.handle("local.launch", { files: null })) as ReturnType<Bridge["snapshot"]>;
        expect(snapshot.browsers.mv2.phase).toBe("idle");
        expect(broadcast).not.toHaveBeenCalled();
    });

    it("ignores an answer to a prompt that does not exist", async () => {
        const { bridge } = makeBridge();
        await expect(bridge.handle("local.answerPrompt", { accept: true })).resolves.toBeTruthy();
    });

    it("serves the source tree and files of a local extension", async () => {
        const { bridge } = makeBridge();
        const files = { mv2: new URL("../../../fixtures/one-ext/manifest.json", import.meta.url).href };
        const tree = (await bridge.handle("local.source.tree", { files, id: "one-ext" })) as {
            entries: { path: string; status: string }[];
        };
        expect(tree.entries.map((e) => e.path)).toContain("manifest.json");
        // One variant only: nothing to diff against, so nothing is marked.
        expect(tree.entries.every((e) => e.status === "unchanged")).toBe(true);
        const file = (await bridge.handle("local.source.file", {
            files,
            id: "one-ext",
            label: "mv2",
            path: "manifest.json",
        })) as { content: string };
        expect(file.content).toContain("manifest_version");
    });

    it("rejects a source read for an unknown variant or an escaping path", async () => {
        const { bridge } = makeBridge();
        const files = { mv2: new URL("../../../fixtures/one-ext", import.meta.url).href };
        await expect(
            bridge.handle("local.source.file", { files, id: "x", label: "nope", path: "manifest.json" }),
        ).rejects.toThrow(/unknown variant/);
        await expect(
            bridge.handle("local.source.file", { files, id: "x", label: "mv2", path: "../../package.json" }),
        ).rejects.toThrow(/outside/);
    });

    it("refuses to resolve remote refs when the tunnel is down", async () => {
        const broadcast = vi.fn();
        const bridge = new Bridge({ client: () => null, ssh: { enabled: () => true, manager: () => null }, broadcast });
        // Silently launching the un-downloaded remote path would load the wrong thing, or nothing.
        await expect(bridge.handle("local.launch", { files: { mv2: "file:///remote/ext" } })).rejects.toThrow(
            /tunnel not up/,
        );
    });
});
