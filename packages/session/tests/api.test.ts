/**
 * Call lifecycle: a request either gets an answer, an error, or a deadline.
 *
 * The deadline is the part worth testing. A dropped connection already fails its in-flight calls, but
 * a host that stays connected and never answers used to leave the caller waiting forever, which
 * reaches the user as a control stuck on its spinner with nothing to click. The timer has to fire when
 * nothing comes back and, just as importantly, has to be cleared when something does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtlensClient } from "../src/api";

/** A WebSocket that connects when told to and records what was sent. */
class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static last: FakeSocket | null = null;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(public url: string) {
        FakeSocket.last = this;
    }
    send(data: string): void {
        this.sent.push(data);
    }
    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }
    /** Complete the handshake the client waits on before it will send anything. */
    open(): void {
        this.readyState = 1;
        this.onopen?.();
    }
    reply(id: number, body: Record<string, unknown>): void {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id, ...body }) });
    }
}

const sentId = (socket: FakeSocket, index = 0): number => JSON.parse(socket.sent[index]).id as number;

async function connected(): Promise<{ client: ExtlensClient; socket: FakeSocket }> {
    const client = new ExtlensClient("ws://test/", () => {});
    client.start();
    const socket = FakeSocket.last!;
    socket.open();
    // Let the client's connect promise settle before anything is called on it.
    await vi.advanceTimersByTimeAsync(0);
    return { client, socket };
}

describe("ExtlensClient calls", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("WebSocket", FakeSocket);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        FakeSocket.last = null;
    });

    it("resolves with the result the host sends", async () => {
        const { client, socket } = await connected();
        const call = client.call<{ ok: boolean }>("ping");
        socket.reply(sentId(socket), { result: { ok: true } });
        await expect(call).resolves.toEqual({ ok: true });
    });

    it("rejects with the host's own error, code and all", async () => {
        const { client, socket } = await connected();
        const call = client.call("runs.select", { id: "nope" });
        socket.reply(sentId(socket), { error: { code: 404, message: "unknown run: nope" } });
        await expect(call).rejects.toThrow("404: unknown run: nope");
    });

    // The bug this exists for: the host stays connected and simply never answers.
    it("gives up on a call nothing ever answers", async () => {
        const { client } = await connected();
        const call = client.call("runs.create", { model: "x" });
        const settled = vi.fn();
        void call.then(settled, settled);

        await vi.advanceTimersByTimeAsync(119_000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2_000);
        await expect(call).rejects.toThrow(/runs\.create timed out after 120s/);
    });

    it("does not fire the deadline for a call that was answered", async () => {
        const { client, socket } = await connected();
        const call = client.call("ping");
        socket.reply(sentId(socket), { result: { ok: true } });
        await expect(call).resolves.toEqual({ ok: true });

        // Past the deadline. A timer left armed would reject an already-settled promise, which is
        // silent here but leaks a handle per call and keeps the process alive in node.
        await expect(vi.advanceTimersByTimeAsync(130_000)).resolves.not.toThrow();
    });

    it("fails in-flight calls when the connection drops, without waiting for the deadline", async () => {
        const { client, socket } = await connected();
        const call = client.call("extensions.list");
        socket.close();
        await expect(call).rejects.toThrow("connection lost");
        client.stop();
    });

    it("refuses to send when there is no connection at all", async () => {
        const client = new ExtlensClient("ws://test/", () => {});
        await expect(client.call("ping")).rejects.toThrow("not connected");
    });
});
