/**
 * The host log: a bottom dock you can drag open.
 *
 * Collapsed by default, because during a batch it is the only thing worth watching and the rest of
 * the time it is noise. Height is the reader's decision rather than ours — a stack trace and a
 * one-line status want very different amounts of room, and a fixed 14 rows is wrong for both.
 *
 * The drag is handled here rather than by a panel library. Two attempts with one produced a dock
 * that shrank but would not grow, because `className` lands on a div nested inside the panel and
 * the sizing contract around it is not visible from the call site. Thirty lines of pointer handling
 * are worth more than a dependency whose failure mode is invisible until it is on screen: this
 * version sets an explicit pixel height, which is exactly as tall as it says it is.
 *
 * It follows new lines only while scrolled to the end, so reading back through a failure is not
 * fought by incoming output.
 */
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { clampDockHeight, heightAfterDrag, MIN_DOCK_HEIGHT } from "@/lib/dock-height";

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
    const [height, setHeight] = useState(224);
    const [dragging, setDragging] = useState(false);

    /**
     * Pointer capture rather than window listeners: the drag keeps following the pointer when it
     * leaves the 6px handle, which it does immediately, and it ends even if the button is released
     * over another element.
     */
    const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const startY = event.clientY;
        const startHeight = height;
        setDragging(true);

        const move = (e: PointerEvent) => setHeight(heightAfterDrag(startHeight, e.clientY - startY, window.innerHeight));
        const end = (e: PointerEvent) => {
            handle.releasePointerCapture(e.pointerId);
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            setDragging(false);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
    };

    // A window that shrank below the stored height would otherwise leave no working area at all.
    useEffect(() => {
        const onResize = () => setHeight((h) => clampDockHeight(h, window.innerHeight));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        const el = scroller.current;
        if (el && pinned.current) el.scrollTop = el.scrollHeight;
    }, [lines.length, open]);

    return (
        <div
            className="flex shrink-0 flex-col border-t bg-card"
            style={open ? { height: Math.max(MIN_DOCK_HEIGHT, height) } : undefined}
        >
            {open ? (
                // The grab strip sits above the bar, so the thing you drag is the dock's own edge.
                <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize host log"
                    onPointerDown={startDrag}
                    className={cn(
                        "group relative h-1.5 shrink-0 cursor-row-resize",
                        dragging ? "bg-ring" : "hover:bg-ring/50",
                    )}
                >
                    <span className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border group-hover:bg-ring" />
                </div>
            ) : null}
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
