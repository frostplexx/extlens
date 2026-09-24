/**
 * The agent's own record of a migration, read top to bottom.
 *
 * A verdict says the migration failed; an explanation guesses why; this is the only artefact that
 * says what actually happened. The question a reviewer brings to it is almost always "did the
 * model never look, or did it look and get it wrong" — so the shape of a turn (thought, called a
 * tool, got an error back) has to be readable at a glance, faster than the words are.
 *
 * Three choices follow from that:
 *
 * - Thinking is collapsed by default. It is half the volume of a run and it is the model talking
 *   to itself; the visible skeleton should be what it did, with the reasoning one click away.
 * - Tool calls and their results are one visual unit, with failure coloured. Scanning for the
 *   moment a run went wrong is the main reason to open a transcript at all.
 * - Nothing is hidden silently. A block the host had to cut says it was cut, a compaction says the
 *   history before it is gone, and a page boundary says how much is left.
 */
import * as React from "react";
import { useMemo, useState } from "react";
import type { TranscriptBlock, TranscriptEntry, TranscriptSummary } from "@extlens/protocol";
import {
    ArrowLeft,
    Bot,
    ChevronRight,
    CircleAlert,
    FileQuestion,
    Layers,
    RefreshCw,
    ScrollText,
    Settings2,
    TriangleAlert,
    User,
    Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { TranscriptState } from "../hooks/useTranscript";
import { Mono } from "./shared";
import { cn } from "@/lib/utils";

/** Arguments and results are shown whole but not endlessly: past this, the block scrolls. */
const BLOCK_MAX_HEIGHT = "max-h-80";

/**
 * Stop reasons that mean "the turn ended the way turns end".
 *
 * Labelling every assistant turn "toolUse" is noise on the one line that should be carrying
 * signal; what a reader needs to see is the turn that stopped for some OTHER reason — a length
 * cap, a refusal — which is rare and always interesting.
 */
const ORDINARY_STOP = new Set(["stop", "end_turn", "endTurn", "toolCall", "toolUse", "tool_use"]);

export function TranscriptView({
    transcript,
    subjectId,
    title,
    onExit,
}: {
    transcript: TranscriptState;
    subjectId: string | null;
    /** The extension's name, when the profile for it has loaded. */
    title: string | null;
    onExit: () => void;
}) {
    const [showThinking, setShowThinking] = useState(false);

    const visible = useMemo(
        () =>
            showThinking
                ? transcript.entries
                : // Dropping the blocks, not the entries: a turn that was only thinking still
                  // happened, and removing it would make the sequence lie about the run's shape.
                  transcript.entries.map((entry) => ({
                      ...entry,
                      blocks: entry.blocks.filter((block) => block.type !== "thinking"),
                  })),
        [transcript.entries, showThinking],
    );

    if (!subjectId) {
        return (
            <Empty className="flex-1">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileQuestion />
                    </EmptyMedia>
                    <EmptyTitle>No extension to show</EmptyTitle>
                    <EmptyDescription>
                        Pick one in Browse first; the transcript is of whatever is selected there.
                    </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={onExit}>
                    <ArrowLeft className="size-4" />
                    Back
                </Button>
            </Empty>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 lg:px-5">
                <Button variant="ghost" size="sm" onClick={onExit}>
                    <ArrowLeft className="size-4" />
                    <span className="hidden sm:inline">Back</span>
                    <Kbd className="hidden lg:inline-flex">Esc</Kbd>
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <h2 className="min-w-0 truncate text-sm font-semibold" title={title ?? subjectId}>
                    {title ?? subjectId}
                </h2>

                {transcript.summary ? <SummaryStrip summary={transcript.summary} /> : null}

                <div className="ml-auto flex shrink-0 items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={showThinking} onCheckedChange={setShowThinking} className="scale-90" />
                        Thinking
                    </label>
                    <Button variant="ghost" size="icon-sm" onClick={transcript.reload} title="Reload transcript">
                        <RefreshCw className="size-4" />
                    </Button>
                </div>
            </div>

            <Body transcript={transcript} entries={visible} />
        </div>
    );
}

function Body({ transcript, entries }: { transcript: TranscriptState; entries: TranscriptEntry[] }) {
    if (transcript.loading && transcript.entries.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
            </div>
        );
    }

    if (transcript.unsupported) {
        return (
            <Empty className="flex-1">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ScrollText />
                    </EmptyMedia>
                    <EmptyTitle>This host keeps no transcripts</EmptyTitle>
                    <EmptyDescription>
                        Transcripts come from a host that runs the migration agent itself. A folder of
                        extensions has no agent, so there is nothing to record.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    if (transcript.error) {
        return (
            <Empty className="flex-1">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <TriangleAlert />
                    </EmptyMedia>
                    <EmptyTitle>Could not read the transcript</EmptyTitle>
                    <EmptyDescription>{transcript.error}</EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={transcript.reload}>
                    <RefreshCw className="size-4" />
                    Try again
                </Button>
            </Empty>
        );
    }

    if (!transcript.available || transcript.total === 0) {
        return (
            <Empty className="flex-1">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ScrollText />
                    </EmptyMedia>
                    <EmptyTitle>No transcript for this extension</EmptyTitle>
                    <EmptyDescription>
                        {/* Two very different situations, and the reviewer can tell which from the row:
                            an extension nobody has migrated, or a run that recorded nothing. */}
                        Either it has not been migrated yet, or it was migrated before the agent kept a
                        record of what it did.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
                {entries.map((entry) => (
                    <Entry key={entry.index} entry={entry} />
                ))}

                <div className="flex items-center justify-center gap-3 py-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                        {transcript.entries.length} of {transcript.total} entries
                    </span>
                    {transcript.hasMore ? (
                        <Button variant="outline" size="sm" onClick={transcript.loadMore} disabled={transcript.loadingMore}>
                            {transcript.loadingMore ? <Spinner className="size-4" /> : null}
                            Load more
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/** Model, volume and cost — the questions asked before reading a word of the conversation. */
function SummaryStrip({ summary }: { summary: TranscriptSummary }) {
    const usage = summary.usage;
    const parts: { label: string; value: string; tone?: string }[] = [
        { label: "turns", value: summary.messages.toLocaleString() },
        { label: "tools", value: summary.toolCalls.toLocaleString() },
    ];
    if (summary.toolErrors > 0) {
        parts.push({ label: "tool failures", value: summary.toolErrors.toLocaleString(), tone: "text-yellow" });
    }
    if (summary.errors > 0) {
        parts.push({ label: "errors", value: summary.errors.toLocaleString(), tone: "text-red" });
    }
    if (summary.compactions > 0) parts.push({ label: "compactions", value: summary.compactions.toLocaleString() });
    if (usage && usage.total > 0) parts.push({ label: "tokens", value: usage.total.toLocaleString() });
    // Zero is a claim the host priced it at nothing; null means nobody priced it, so it is absent.
    if (usage && usage.costUsd !== null) parts.push({ label: "cost", value: `$${usage.costUsd.toFixed(2)}` });

    return (
        <div className="hidden min-w-0 items-center gap-3 text-xs text-muted-foreground md:flex">
            {summary.model ? (
                <Badge variant="outline" className="shrink-0 font-normal">
                    <Bot className="size-3" />
                    <span className="truncate">{summary.model}</span>
                </Badge>
            ) : null}
            {parts.map((part) => (
                <span key={part.label} className="shrink-0 whitespace-nowrap">
                    <span className={cn("font-medium tabular-nums", part.tone ?? "text-foreground")}>{part.value}</span>{" "}
                    {part.label}
                </span>
            ))}
        </div>
    );
}

const ROLE_STYLE = {
    user: { Icon: User, label: "User", tone: "text-green", edge: "border-l-green/50" },
    assistant: { Icon: Bot, label: "Assistant", tone: "text-blue", edge: "border-l-blue/40" },
    tool: { Icon: Wrench, label: "Tool", tone: "text-yellow", edge: "border-l-yellow/40" },
} as const;

function Entry({ entry }: { entry: TranscriptEntry }) {
    if (entry.kind === "meta") return <MetaLine entry={entry} />;
    if (entry.kind === "compaction") return <Compaction entry={entry} />;

    const role = entry.role ?? "assistant";
    const style = ROLE_STYLE[role];
    const failed = entry.error !== null || entry.isError;

    return (
        <article
            className={cn(
                "rounded-md border border-l-2 bg-card/40 px-3 py-2",
                failed ? "border-l-red/60 bg-destructive/5" : style.edge,
            )}
        >
            <header className="flex items-center gap-2 text-xs">
                <style.Icon className={cn("size-3.5", failed ? "text-red" : style.tone)} />
                <span className="font-medium">{entry.toolName ?? style.label}</span>
                {entry.isError ? (
                    <Badge variant="destructive" className="font-normal">
                        failed
                    </Badge>
                ) : null}
                {entry.stopReason && !ORDINARY_STOP.has(entry.stopReason) ? (
                    <span className="text-muted-foreground">{entry.stopReason}</span>
                ) : null}
                <span className="ml-auto flex items-center gap-2 text-muted-foreground">
                    {entry.usage && entry.usage.total > 0 ? (
                        <span className="tabular-nums">{entry.usage.total.toLocaleString()} tok</span>
                    ) : null}
                    <Timestamp at={entry.at} />
                </span>
            </header>

            {entry.error ? (
                <p className="mt-2 flex items-start gap-2 rounded-sm bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    {entry.error}
                </p>
            ) : null}

            {entry.blocks.map((block, i) => (
                <Block key={i} block={block} />
            ))}

            {/* A turn that is only a tool call has no prose; saying so beats an empty card that
                looks like a rendering fault. */}
            {entry.blocks.length === 0 && !entry.error ? (
                <p className="mt-1 text-sm text-muted-foreground">(no content)</p>
            ) : null}
        </article>
    );
}

function Block({ block }: { block: TranscriptBlock }) {
    if (block.type === "thinking") {
        // Shown in full: the reader asked for thinking with the toggle above, and making them
        // click again per block would be the same decision twice.
        return (
            <div className="mt-2 border-l-2 border-muted pl-2 text-muted-foreground">
                <pre
                    className={cn(
                        "overflow-auto whitespace-pre-wrap break-words font-sans text-sm italic",
                        BLOCK_MAX_HEIGHT,
                    )}
                >
                    {block.text}
                </pre>
                {block.truncated ? <TruncatedNote /> : null}
            </div>
        );
    }

    if (block.type === "tool_call") {
        return (
            <div className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5">
                <div className="flex items-center gap-2 text-xs">
                    <Wrench className="size-3.5 text-yellow" />
                    <Mono className="font-medium text-foreground">{block.name}</Mono>
                </div>
                {block.arguments.trim() === "" || block.arguments.trim() === "{}" ? null : (
                    <pre
                        className={cn(
                            "mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground",
                            BLOCK_MAX_HEIGHT,
                        )}
                    >
                        {block.arguments}
                    </pre>
                )}
                {block.truncated ? <TruncatedNote /> : null}
            </div>
        );
    }

    return (
        <>
            <pre
                className={cn(
                    "mt-2 overflow-auto whitespace-pre-wrap break-words font-sans text-sm",
                    BLOCK_MAX_HEIGHT,
                )}
            >
                {block.text}
            </pre>
            {block.truncated ? <TruncatedNote /> : null}
        </>
    );
}

/** The host cut this. Said plainly, because silently shortened evidence is worse than less of it. */
function TruncatedNote() {
    return <p className="mt-1 text-xs italic text-muted-foreground">… truncated by the host</p>;
}

function Foldable({
    label,
    body,
    className,
    truncated,
}: {
    label: string;
    body: React.ReactNode;
    className?: string;
    truncated: boolean;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className={className}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 text-xs hover:text-foreground"
            >
                <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
                {label}
            </button>
            {open ? (
                <div className="mt-1">
                    {body}
                    {truncated ? <TruncatedNote /> : null}
                </div>
            ) : null}
        </div>
    );
}

function MetaLine({ entry }: { entry: TranscriptEntry }) {
    return (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Settings2 className="size-3" />
            <span className="font-medium">{entry.label}</span>
            <Mono className="truncate">{entry.detail}</Mono>
            <span className="ml-auto">
                <Timestamp at={entry.at} />
            </span>
        </div>
    );
}

/**
 * A compaction, drawn as a break in the page rather than as a message.
 *
 * Everything before it was summarised away by the agent to fit its context window. A reader who
 * takes the summary for the model's own reasoning misreads every turn that follows it.
 */
function Compaction({ entry }: { entry: TranscriptEntry }) {
    const text = entry.blocks.find((b) => b.type === "text");
    return (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Layers className="size-3.5" />
                <span className="font-medium text-foreground">History compacted</span>
                {entry.detail ? <span>{entry.detail}</span> : null}
                <span className="ml-auto">
                    <Timestamp at={entry.at} />
                </span>
            </div>
            {text && text.type === "text" && text.text.trim() !== "" ? (
                <Foldable
                    label="Summary the agent kept"
                    className="mt-1 text-muted-foreground"
                    truncated={text.truncated}
                    body={<pre className="whitespace-pre-wrap break-words font-sans text-sm">{text.text}</pre>}
                />
            ) : null}
        </div>
    );
}

function Timestamp({ at }: { at: string | null }) {
    if (!at) return null;
    const date = new Date(at);
    return (
        <time dateTime={at} className="tabular-nums" title={date.toLocaleString()}>
            {date.toLocaleTimeString()}
        </time>
    );
}
