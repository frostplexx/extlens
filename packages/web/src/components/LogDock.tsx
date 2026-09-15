/**
 * The host log: a bottom dock you can drag open.
 *
 * Collapsed by default, because during a batch it is the only thing worth watching and the rest of
 * the time it is noise. Height is the reader's decision rather than ours — a stack trace and a
 * one-line status want very different amounts of room, and a fixed 14 rows is wrong for both — so
 * when it is open it lives in a resizable panel and the handle is the top edge of this bar.
 *
 * It follows new lines only while scrolled to the end, so reading back through a failure is not
 * fought by incoming output.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/**
 * Phase as a coloured dot and a word, not a pill.
 *
 * A badge is a label stuck onto the bar; this is the bar reporting its own state. The dot carries
 * the severity so the word does not have to shout, which matters when the word changes every few
 * minutes for hours.
 */
function PhaseLine({ status, error }: { status: HostStatus | null; error: string | null }) {
    if (error) {
        return (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
                <span className="size-1.5 rounded-full bg-destructive" />
                {error}
            </span>
        );
    }
    const phase = status?.phase;
    if (!phase) return null;
    const running = status?.state === "running" || status?.state === "stopping";
    const tone =
        phase === "failed" ? "bg-destructive" : phase === "done" ? "bg-green" : running ? "bg-peach" : "bg-muted-foreground";
    return (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", tone, running && "animate-pulse")} />
            {phase}
            {status?.extensionId ? <span className="hidden font-mono text-xs opacity-60 xl:inline">{status.extensionId}</span> : null}
        </span>
    );
}

export function LogDock({
    open,
    onOpenChange,
    status,
    lines,
    error,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    status: HostStatus | null;
    lines: LogLine[];
    error: string | null;
}) {
    const scroller = useRef<HTMLDivElement>(null);
    const pinned = useRef(true);

    useEffect(() => {
        const el = scroller.current;
        if (el && pinned.current) el.scrollTop = el.scrollHeight;
    }, [lines.length, open]);

    return (
        <div className={cn("flex min-h-0 flex-col bg-card", !open && "shrink-0 border-t")}>
            <div className="flex h-10 shrink-0 items-center gap-3 px-3">
                <Button size="sm" variant="ghost" onClick={() => onOpenChange(!open)}>
                    {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                    Host log
                </Button>
                <PhaseLine status={status} error={error} />
                <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">{lines.length} lines</span>
                    <Kbd>l</Kbd>
                </div>
            </div>
            {open ? (
                <div
                    ref={scroller}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                    }}
                    className="min-h-0 flex-1 overflow-auto border-t px-4 py-2 font-mono text-xs leading-5"
                >
                    {lines.length === 0 ? (
                        <p className="text-muted-foreground">{status?.message ?? "No output from the host yet."}</p>
                    ) : (
                        lines.map((line) => (
                            <div
                                key={line.seq}
                                className={cn(
                                    "whitespace-pre-wrap break-all",
                                    line.stream === "stderr" ? "text-destructive" : "text-foreground/80",
                                )}
                            >
                                {line.text}
                            </div>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    );
}
