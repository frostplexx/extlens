/**
 * The export's transcripts are evidence for a later pass over the failures, so the cases that
 * matter are the ones where a short or mislabelled transcript would change what that pass concludes.
 */
import { describe, expect, it, vi } from "vitest";
import type { TranscriptEntry, TranscriptResult } from "@extlens/protocol";
import { collectTranscripts, fetchTranscript } from "../src/renderer/lib/collect-transcripts";

const entry = (index: number): TranscriptEntry => ({
    index,
    at: null,
    kind: "message",
    role: "assistant",
    blocks: [{ type: "text", text: `turn ${index}`, truncated: false }],
    toolName: null,
    callId: null,
    isError: false,
    model: null,
    provider: null,
    stopReason: null,
    error: null,
    usage: null,
    label: "",
    detail: "",
});

/** A host serving `count` entries, one page per call, recording the offsets it was asked for. */
function host(count: number) {
    const offsets: number[] = [];
    const call = async <T,>(_method: string, params?: Record<string, unknown>): Promise<T> => {
        const offset = Number(params?.offset ?? 0);
        const limit = Number(params?.limit ?? 500);
        offsets.push(offset);
        const all = Array.from({ length: count }, (_, i) => entry(i));
        return {
            available: true,
            entries: all.slice(offset, offset + limit),
            total: count,
            offset,
            limit,
            summary: null,
        } as TranscriptResult as T;
    };
    return { call, offsets };
}

describe("fetchTranscript", () => {
    it("pages to the end, because a transcript cut off halfway misrepresents the run", async () => {
        const { call, offsets } = host(1_200);
        const result = await fetchTranscript(call, "abc");
        expect(result.entries.map((e) => e.index)).toEqual(Array.from({ length: 1_200 }, (_, i) => i));
        expect(result.total).toBe(1_200);
        expect(offsets).toEqual([0, 500, 1_000]);
    });

    it("keeps the host's summary from the first page rather than the last", async () => {
        const call = async <T,>(_m: string, params?: Record<string, unknown>): Promise<T> =>
            ({
                available: true,
                entries: Number(params?.offset) === 0 ? [entry(0)] : [entry(1)],
                total: 2,
                offset: Number(params?.offset ?? 0),
                limit: 500,
                summary: Number(params?.offset) === 0 ? { model: "gemma", messages: 2 } : null,
            }) as unknown as T;
        const result = await fetchTranscript(call, "abc");
        expect(result.summary).toMatchObject({ model: "gemma" });
    });

    it("reports an unmigrated extension as absent, not as an error", async () => {
        const call = async <T,>(): Promise<T> =>
            ({ available: false, entries: [], total: 0, offset: 0, limit: 500, summary: null }) as TranscriptResult as T;
        const result = await fetchTranscript(call, "abc");
        expect(result).toMatchObject({ available: false, absence: "none" });
        expect(result.error).toBeUndefined();
    });

    it("distinguishes a host that keeps no transcripts from one whose read failed", async () => {
        const unsupported = await fetchTranscript(async () => {
            throw new Error("method not found: transcript.get");
        }, "abc");
        expect(unsupported.absence).toBe("unsupported");

        const broken = await fetchTranscript(async () => {
            throw new Error("EACCES");
        }, "abc");
        expect(broken).toMatchObject({ absence: "error", error: "EACCES" });
    });

    it("keeps the pages that arrived when a later one fails, and says it is short", async () => {
        let calls = 0;
        const result = await fetchTranscript(async <T,>(): Promise<T> => {
            if (calls++ > 0) throw new Error("socket closed");
            return {
                available: true,
                entries: Array.from({ length: 500 }, (_, i) => entry(i)),
                total: 900,
                offset: 0,
                limit: 500,
                summary: null,
            } as TranscriptResult as T;
        }, "abc");
        expect(result.available).toBe(true);
        expect(result.entries).toHaveLength(500);
        // The pass reading this must be able to see it is missing 400 entries.
        expect(result.total).toBe(900);
        expect(result.error).toBe("socket closed");
    });

    it("stops on an empty page even when the host's total disagrees", async () => {
        let calls = 0;
        const call = vi.fn(async <T,>(): Promise<T> => {
            calls++;
            return { available: true, entries: [], total: 10_000, offset: 0, limit: 500, summary: null } as TranscriptResult as T;
        });
        const result = await fetchTranscript(call, "abc");
        expect(calls).toBe(1);
        expect(result.entries).toEqual([]);
    });
});

describe("collectTranscripts", () => {
    it("keys transcripts by extension id so each one stays attributable", async () => {
        const call = async <T,>(_m: string, params?: Record<string, unknown>): Promise<T> =>
            ({
                available: true,
                entries: [entry(0)],
                total: 1,
                offset: 0,
                limit: 500,
                summary: { model: String(params?.extensionId) },
            }) as unknown as T;
        const byId = await collectTranscripts(call, ["a", "b"]);
        expect(byId.a.summary).toMatchObject({ model: "a" });
        expect(byId.b.summary).toMatchObject({ model: "b" });
    });

    it("asks a host without transcripts once, then marks the rest", async () => {
        const call = vi.fn(async () => {
            throw new Error("-32601");
        });
        const byId = await collectTranscripts(call, ["a", "b", "c"]);
        expect(call).toHaveBeenCalledTimes(1);
        expect(Object.values(byId).every((t) => t.absence === "unsupported")).toBe(true);
    });

    it("reports progress per extension, since this is the slow half of an export", async () => {
        const call = async <T,>(): Promise<T> =>
            ({ available: false, entries: [], total: 0, offset: 0, limit: 500, summary: null }) as TranscriptResult as T;
        const seen: [number, number][] = [];
        await collectTranscripts(call, ["a", "b"], (done, total) => seen.push([done, total]));
        expect(seen).toEqual([
            [1, 2],
            [2, 2],
        ]);
    });
});
