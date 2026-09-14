/**
 * The host log, as a bottom drawer.
 *
 * Collapsed by default: during a batch migration it is the only thing worth watching, and the
 * rest of the time it is noise. It follows new lines only while scrolled to the end, so reading
 * back through a failure is not fought by incoming output.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

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
        <Collapsible open={open} onOpenChange={onOpenChange} className="shrink-0 border-t bg-card">
            <div className="flex h-10 items-center gap-3 px-3">
                <CollapsibleTrigger asChild>
                    <Button size="sm" variant="ghost">
                        {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                        Host log
                    </Button>
                </CollapsibleTrigger>
                {status?.phase ? <Badge variant="outline">{status.phase}</Badge> : null}
                {error ? <span className="text-sm text-destructive">{error}</span> : null}
                <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">{lines.length} lines</span>
                    <Kbd>l</Kbd>
                </div>
            </div>
            <CollapsibleContent>
                <div
                    ref={scroller}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                    }}
                    className="h-56 overflow-auto border-t px-4 py-2 font-mono text-xs leading-5"
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
            </CollapsibleContent>
        </Collapsible>
    );
}
