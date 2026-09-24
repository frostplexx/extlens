/**
 * Building transcript entries, and reading a whole transcript at a glance.
 *
 * The parsing of an agent's own log belongs to the host that runs that agent — only it knows what
 * its framework writes. What does not belong there is the arithmetic: if one host counted a failed
 * tool call as an error and another did not, two rows of a corpus comparison would be measuring
 * different things. So hosts map their records onto `TranscriptEntry` and call `summarizeTranscript`
 * over the result; the numbers then mean the same thing wherever they were computed.
 */
import type {
  TranscriptBlock,
  TranscriptEntry,
  TranscriptSummary,
  TranscriptUsage,
} from "./types.js";

/**
 * Longest block of text a host should send per block.
 *
 * A single tool result can be an entire bundled file; a handful of those in one page is a frame
 * measured in megabytes, for text no reader will scroll through. Cut it, and say it was cut —
 * a viewer that silently shortens evidence is worse than one that shows less of it.
 */
export const TRANSCRIPT_BLOCK_LIMIT = 20_000;

/** Cut a block's text to the limit, marking it when anything was dropped. */
export function truncateBlockText(
  text: string,
  limit: number = TRANSCRIPT_BLOCK_LIMIT,
): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

const ZERO_USAGE: TranscriptUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  costUsd: null,
};

/**
 * Add one entry's usage to a running total.
 *
 * Cost stays null until something reports one, rather than starting at zero: a transcript from a
 * host that prices nothing would otherwise claim the run was free.
 */
function addUsage(total: TranscriptUsage | null, next: TranscriptUsage): TranscriptUsage {
  const base = total ?? ZERO_USAGE;
  const cost =
    next.costUsd === null ? base.costUsd : (base.costUsd ?? 0) + next.costUsd;
  return {
    input: base.input + next.input,
    output: base.output + next.output,
    cacheRead: base.cacheRead + next.cacheRead,
    cacheWrite: base.cacheWrite + next.cacheWrite,
    total: base.total + next.total,
    costUsd: cost,
  };
}

/** Does this block carry a tool call? Narrow, so callers do not re-spell the discriminant. */
export function isToolCall(block: TranscriptBlock): boolean {
  return block.type === "tool_call";
}

/**
 * The whole transcript in one line.
 *
 * Pass every entry, not the page being displayed: a summary that describes the visible page would
 * report a different cost each time the reader scrolled.
 *
 * The model reported is the last one that spoke, not the first. A run that changed model mid-way
 * ended as the second one, and the last turn is the one that produced the output being judged.
 *
 * The span is the earliest and latest timestamp, not the first and last entry's. Agent logs are
 * not written in time order — pi stamps its session record when the file is exported, which is
 * after everything it describes — so reading the ends of the list gives a run that finished
 * before it started.
 */
export function summarizeTranscript(entries: TranscriptEntry[]): TranscriptSummary {
  const summary: TranscriptSummary = {
    model: null,
    provider: null,
    messages: 0,
    toolCalls: 0,
    toolErrors: 0,
    errors: 0,
    compactions: 0,
    startedAt: null,
    endedAt: null,
    usage: null,
  };

  for (const entry of entries) {
    if (entry.at) {
      if (summary.startedAt === null || entry.at < summary.startedAt) summary.startedAt = entry.at;
      if (summary.endedAt === null || entry.at > summary.endedAt) summary.endedAt = entry.at;
    }
    if (entry.kind === "compaction") summary.compactions++;
    if (entry.kind === "message") summary.messages++;
    if (entry.model) summary.model = entry.model;
    if (entry.provider) summary.provider = entry.provider;
    if (entry.error) summary.errors++;
    if (entry.role === "tool" && entry.isError) summary.toolErrors++;
    summary.toolCalls += entry.blocks.filter(isToolCall).length;
    if (entry.usage) summary.usage = addUsage(summary.usage, entry.usage);
  }

  return summary;
}

/**
 * An ISO timestamp from whatever the agent wrote, or null.
 *
 * Agent logs mix epoch milliseconds with ISO strings inside a single file — pi writes one at the
 * record level and the other inside the message — and a viewer that renders "1787146465786" as a
 * time is showing the reader nothing. Null is the honest answer for anything unparseable.
 */
export function transcriptTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
