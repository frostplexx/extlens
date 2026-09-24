/**
 * The summary is the part of a transcript a reader trusts without checking: it is what a corpus
 * comparison quotes when it says one model cost twice as much as another. So the cases here are
 * the ones where a plausible implementation would produce a confident wrong number — a run whose
 * records are not in time order, a host that prices nothing, a model swapped mid-run.
 */
import { describe, expect, it } from "vitest";
import type { TranscriptEntry, TranscriptUsage } from "../src/index.js";
import {
    TRANSCRIPT_BLOCK_LIMIT,
    summarizeTranscript,
    transcriptTimestamp,
    truncateBlockText,
} from "../src/index.js";

const usage = (over: Partial<TranscriptUsage> = {}): TranscriptUsage => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    costUsd: null,
    ...over,
});

const entry = (over: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
    index: 0,
    at: null,
    kind: "message",
    role: "assistant",
    blocks: [],
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
    ...over,
});

describe("summarising a transcript", () => {
    it("counts messages, tool calls and compactions", () => {
        const summary = summarizeTranscript([
            entry({ role: "user" }),
            entry({
                blocks: [
                    { type: "thinking", text: "hm", truncated: false },
                    { type: "tool_call", name: "ls", arguments: "{}", callId: null, truncated: false },
                    { type: "tool_call", name: "read", arguments: "{}", callId: null, truncated: false },
                ],
            }),
            entry({ kind: "compaction", role: null, label: "history compacted" }),
            entry({ kind: "meta", role: null, label: "model" }),
        ]);
        expect(summary.messages).toBe(2);
        expect(summary.toolCalls).toBe(2);
        expect(summary.compactions).toBe(1);
    });

    it("keeps a broken turn apart from a tool that reported failure", () => {
        // They look alike in a log and mean opposite things: one is the run falling over, the
        // other is the agent's own tooling working correctly and saying "that failed".
        const summary = summarizeTranscript([
            entry({ error: "500 Internal Server Error", stopReason: "error" }),
            entry({ role: "tool", toolName: "bash", isError: true }),
            entry({ role: "tool", toolName: "ls", isError: false }),
        ]);
        expect(summary.errors).toBe(1);
        expect(summary.toolErrors).toBe(1);
    });

    it("reports the model that finished the run", () => {
        const summary = summarizeTranscript([
            entry({ model: "first", provider: "saia" }),
            entry({ model: "second", provider: "saia" }),
        ]);
        expect(summary.model).toBe("second");
    });

    it("spans the earliest and latest timestamps, whatever order the records are in", () => {
        // A real pi export opens with a session record stamped when the file was written — after
        // everything it describes. Reading the ends of the list gives a run that finished first.
        const summary = summarizeTranscript([
            entry({ kind: "meta", role: null, at: "2026-08-19T13:19:25.477Z" }),
            entry({ at: "2026-08-19T13:10:00.000Z" }),
            entry({ at: "2026-08-19T13:19:21.341Z" }),
        ]);
        expect(summary.startedAt).toBe("2026-08-19T13:10:00.000Z");
        expect(summary.endedAt).toBe("2026-08-19T13:19:25.477Z");
    });

    it("adds usage up across turns", () => {
        const summary = summarizeTranscript([
            entry({ usage: usage({ input: 10, output: 2, total: 12, costUsd: 0.5 }) }),
            entry({ usage: usage({ input: 5, output: 1, total: 6, costUsd: 0.25 }) }),
        ]);
        expect(summary.usage).toEqual(usage({ input: 15, output: 3, total: 18, costUsd: 0.75 }));
    });

    it("leaves cost null when nothing priced the run, rather than claiming it was free", () => {
        const summary = summarizeTranscript([entry({ usage: usage({ input: 10, total: 10 }) })]);
        expect(summary.usage!.total).toBe(10);
        expect(summary.usage!.costUsd).toBeNull();
    });

    it("has nothing to say about an empty transcript", () => {
        const summary = summarizeTranscript([]);
        expect(summary).toMatchObject({ messages: 0, toolCalls: 0, model: null, usage: null, startedAt: null });
    });
});

describe("truncating a block", () => {
    it("leaves a short block alone", () => {
        expect(truncateBlockText("short")).toEqual({ text: "short", truncated: false });
    });

    it("cuts at the limit and says it cut", () => {
        const cut = truncateBlockText("x".repeat(TRANSCRIPT_BLOCK_LIMIT + 1));
        expect(cut.text.length).toBe(TRANSCRIPT_BLOCK_LIMIT);
        expect(cut.truncated).toBe(true);
    });
});

describe("reading an agent's timestamps", () => {
    it("accepts epoch milliseconds and ISO strings alike", () => {
        expect(transcriptTimestamp(1787146465786)).toBe(new Date(1787146465786).toISOString());
        expect(transcriptTimestamp("2026-08-23T11:17:22.675Z")).toBe("2026-08-23T11:17:22.675Z");
    });

    it("returns null for anything it cannot read, rather than a wrong time", () => {
        for (const value of [undefined, null, "", "   ", "not a date", Number.NaN, {}]) {
            expect(transcriptTimestamp(value)).toBeNull();
        }
    });
});
