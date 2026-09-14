/**
 * The host log, as a collapsible dock.
 *
 * Collapsed by default and pinned to the bottom: during a batch migration it is the only thing
 * worth watching, and the rest of the time it is noise. It auto-scrolls only while pinned to the
 * end, so reading back through a failure is not fought by incoming lines.
 */
import React, { useEffect, useRef } from "react";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { Button } from "./primitives.js";

export function LogDock({
    open,
    onToggle,
    status,
    lines,
    error,
}: {
    open: boolean;
    onToggle: () => void;
    status: HostStatus | null;
    lines: LogLine[];
    error: string | null;
}) {
    const scroller = useRef<HTMLDivElement | null>(null);
    const pinned = useRef(true);

    useEffect(() => {
        const el = scroller.current;
        if (el && pinned.current) el.scrollTop = el.scrollHeight;
    }, [lines.length, open]);

    return (
        <div className="border-t border-surface1 bg-mantle">
            <div className="flex items-center justify-between px-4 py-1.5">
                <div className="flex items-center gap-2">
                    <Button onClick={onToggle}>{open ? "▾ host log" : "▸ host log"}</Button>
                    {status?.phase ? <span className="text-overlay0">{status.phase}</span> : null}
                    {error ? <span className="text-red">{error}</span> : null}
                </div>
                <span className="text-overlay0">{lines.length} lines</span>
            </div>
            {open ? (
                <div
                    ref={scroller}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                    }}
                    className="h-56 overflow-auto border-t border-surface0 px-4 py-2 text-[12px] leading-5"
                >
                    {lines.length === 0 ? (
                        <div className="text-overlay0">{status?.message ?? "(no output from the host yet)"}</div>
                    ) : (
                        lines.map((line) => (
                            <div
                                key={line.seq}
                                className={`whitespace-pre-wrap break-all ${line.stream === "stderr" ? "text-red" : "text-subtext1"}`}
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
