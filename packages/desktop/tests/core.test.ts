/**
 * The core is the part of the app that decides where passwords go, so that is what these pin:
 * a saved secret is used before anyone is asked, a typed one is stored only after the tunnel
 * comes up, and an answer to a stale prompt is dropped. Everything talks through the same
 * `handle()` the renderer uses, so the protocol between them is exercised too.
 */
import { describe, expect, it, vi } from "vitest";

// The ssh manager is the only thing in the core that touches the network; a fake lets a test
// drive it through the same `getSecret`/`onStatus` contract the real one honours.
type Fake = {
    options: { getSecret: () => Promise<string>; onStatus: (s: string, m?: string) => void };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};
const managers: Fake[] = [];

vi.mock("@extlens/session", async () => {
    const actual = await vi.importActual<typeof import("@extlens/session")>("@extlens/session");
    return {
        ...actual,
        createSshManager: (options: Fake["options"]) => {
            const fake: Fake = { options, start: vi.fn(), stop: vi.fn(), } as Fake;
            managers.push(fake);
            return { ...fake, session: null, localPort: 55555, checkNow: vi.fn() };
        },
        ExtlensClient: class {
            constructor(_url: string, _onStatus: unknown) {}
            start() {}
            stop() {}
            call() {
                return Promise.reject(new Error("not connected"));
            }
        },
    };
});

const { createCore, parseTarget, targetFromArgs } = await import("../src/main/core.js");

/** Let the core's own awaits (the keychain lookup before a prompt) settle. */
const settle = () => new Promise<void>((r) => setImmediate(r));

function memoryStore(seed: Record<string, string> = {}) {
    const vault = new Map(Object.entries(seed));
    return {
        vault,
        store: {
            load: vi.fn(async (d: string) => vault.get(d) ?? null),
            save: vi.fn(async (d: string, s: string) => void vault.set(d, s)),
            forget: vi.fn(async (d: string) => void vault.delete(d)),
            list: vi.fn(async () => [...vault.keys()]),
        },
    };
}

const SSH = { kind: "ssh" as const, destination: "me@box", remotePort: 8081 };

describe("targets", () => {
    it("reads flags and falls back to nothing", () => {
        expect(targetFromArgs(["--ssh", "me@box", "--remote-port", "9000"], {})).toEqual({ ...SSH, remotePort: 9000 });
        expect(targetFromArgs(["--ws", "ws://h:1"], {})).toEqual({ kind: "ws", url: "ws://h:1" });
        expect(targetFromArgs([], {})).toBeNull();
    });

    it("refuses input that could reach ssh as an option or is not a socket URL", () => {
        expect(() => parseTarget({ kind: "ssh", destination: "-oProxyCommand=x" })).toThrow(/destination/);
        expect(() => parseTarget({ kind: "ssh", destination: "a b" })).toThrow(/destination/);
        expect(() => parseTarget({ kind: "ws", url: "http://h" })).toThrow(/WebSocket/);
        expect(parseTarget({ kind: "ssh", destination: " me@box ", remotePort: "" })).toEqual(SSH);
    });
});

describe("ssh password flow", () => {
    it("uses the saved password before asking anyone", async () => {
        managers.length = 0;
        const { store } = memoryStore({ "me@box": "hunter2" });
        const emit = vi.fn();
        const core = createCore({ emit, credentials: store });
        await core.handle("local.session.connect", { target: SSH });
        const fake = managers[0]!;
        await expect(fake.options.getSecret()).resolves.toBe("hunter2");
        expect(core.sessionState().prompt).toBeNull();
    });

    it("prompts the UI when nothing is saved, and marks the retry", async () => {
        managers.length = 0;
        const { store } = memoryStore();
        const core = createCore({ emit: vi.fn(), credentials: store });
        await core.handle("local.session.connect", { target: SSH });
        const fake = managers[0]!;

        const first = fake.options.getSecret();
        await settle();
        const prompt = core.sessionState().prompt!;
        expect(prompt).toMatchObject({ destination: "me@box", retry: false });
        await core.handle("local.session.secret", { id: prompt.id, secret: "wrong" });
        await expect(first).resolves.toBe("wrong");

        const second = fake.options.getSecret();
        await settle();
        expect(core.sessionState().prompt!.retry).toBe(true);
        await core.handle("local.session.secret", { id: core.sessionState().prompt!.id, secret: "" });
        await expect(second).resolves.toBe("");
    });

    it("ignores an answer to a prompt that is not the open one", async () => {
        managers.length = 0;
        const core = createCore({ emit: vi.fn(), credentials: memoryStore().store });
        await core.handle("local.session.connect", { target: SSH });
        const pending = managers[0]!.options.getSecret();
        await settle();
        const { id } = core.sessionState().prompt!;
        await core.handle("local.session.secret", { id: id + 1, secret: "stale" });
        expect(core.sessionState().prompt).not.toBeNull();
        await core.handle("local.session.secret", { id, secret: "right" });
        await expect(pending).resolves.toBe("right");
    });

    it("saves a typed password only once the tunnel is up, and not a rejected one", async () => {
        managers.length = 0;
        const { store, vault } = memoryStore();
        const core = createCore({ emit: vi.fn(), credentials: store });
        await core.handle("local.session.connect", { target: SSH, secret: "typed", remember: true });
        const fake = managers[0]!;

        await expect(fake.options.getSecret()).resolves.toBe("typed");
        expect(store.save).not.toHaveBeenCalled();

        // ssh rejects it and asks again; the user cancels. Nothing must be stored.
        const again = fake.options.getSecret();
        await settle();
        await core.handle("local.session.secret", { id: core.sessionState().prompt!.id, secret: "" });
        await again;
        fake.options.onStatus("failed", "ssh auth cancelled");
        expect(vault.size).toBe(0);

        // A fresh connect where the typed password works.
        await core.handle("local.session.connect", { target: SSH, secret: "typed", remember: true });
        const next = managers[1]!;
        await next.options.getSecret();
        next.options.onStatus("up");
        await Promise.resolve();
        expect(vault.get("me@box")).toBe("typed");
    });

    it("never stores without a keychain, and says so", async () => {
        managers.length = 0;
        const core = createCore({ emit: vi.fn() });
        expect(core.sessionState().canRemember).toBe(false);
        await core.handle("local.session.connect", { target: SSH, secret: "typed", remember: true });
        const fake = managers[0]!;
        await fake.options.getSecret();
        fake.options.onStatus("up");
        expect(await core.handle("local.session.hasSecret", { destination: "me@box" })).toEqual({ saved: false });
    });

    it("tears down the old tunnel and drops its prompt when the target changes", async () => {
        managers.length = 0;
        const core = createCore({ emit: vi.fn(), credentials: memoryStore().store });
        await core.handle("local.session.connect", { target: SSH });
        const first = managers[0]!;
        const pending = first.options.getSecret();
        await settle();
        await core.handle("local.session.connect", { target: { kind: "ws", url: "ws://localhost:1" } });
        expect(first.stop).toHaveBeenCalled();
        await expect(pending).resolves.toBe("");
        expect(core.sessionState()).toMatchObject({ prompt: null, target: { kind: "ws" }, tunnel: null });

        // A late status from the replaced tunnel must not overwrite the new target's state.
        first.options.onStatus("failed", "late");
        expect(core.sessionState().tunnel).toBeNull();
    });
});

describe("routing", () => {
    it("replays current state on request and refuses the host while disconnected", async () => {
        const emit = vi.fn();
        const core = createCore({ emit });
        await core.handle("local.replay", {});
        expect(emit.mock.calls.map(([e]) => e)).toEqual(["session", "local.browsers"]);
        await expect(core.handle("extensions.list", {})).rejects.toThrow(/not connected/);
        await expect(core.handle("local.session.nope", {})).rejects.toThrow(/unknown session method/);
    });
});
