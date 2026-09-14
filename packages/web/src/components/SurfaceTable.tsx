/**
 * Per-surface results: one row per thing the extension actually exposes.
 *
 * The old form asked about three surfaces because those were the three it had fields for. An
 * extension whose entire UI is a context menu and a keyboard shortcut had nowhere to record that
 * its only feature was broken, and the corpus-level tables the paper needs ("of 200 extensions
 * with a custom new tab, 120 work") cannot be built from a form that never asked.
 *
 * Statuses are deliberately four, not two. "Not testable" is a statement about the harness — a
 * popup behind a paid login, a surface that needs a device — and collapsing it into "broken" is
 * what makes a migration success rate unfalsifiable.
 */
import * as React from "react";
import type { DetectedSurface, SurfaceResult, SurfaceStatus, UiSurface } from "@extlens/protocol";
import { SURFACE_HINTS, SURFACE_LABELS } from "@extlens/protocol";
import { CircleDashed, CircleSlash, CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUSES: { value: SurfaceStatus; label: string; icon: React.ElementType; tone: string }[] = [
    { value: "untested", label: "Untested", icon: CircleDashed, tone: "text-muted-foreground" },
    { value: "working", label: "Works", icon: CheckCircle2, tone: "text-green" },
    { value: "partial", label: "Partly works", icon: CircleAlert, tone: "text-yellow" },
    { value: "broken", label: "Broken", icon: XCircle, tone: "text-red" },
    { value: "not_testable", label: "Can't test", icon: CircleSlash, tone: "text-blue" },
];

export function SurfaceTable({
    detected,
    results,
    onChange,
}: {
    detected: DetectedSurface[];
    results: SurfaceResult[];
    onChange: (surface: UiSurface, patch: Partial<SurfaceResult>) => void;
}) {
    if (detected.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                No user-facing surfaces detected. If this extension clearly has UI, the host may be serving
                profiles from an older build — restart it.
            </p>
        );
    }

    return (
        /*
         * A container query, not a viewport one: this table renders both in the narrow browse
         * aside and in the wide review column, and which of those it is in has nothing to do with
         * the window size. Labels appear when the table itself has room for them.
         */
        <div className="@container divide-y rounded-md border">
            {detected.map(({ surface, evidence }) => {
                const result = results.find((r) => r.surface === surface);
                const status = result?.status ?? "untested";
                return (
                    <div key={surface} className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-0.5">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="text-sm font-medium">{SURFACE_LABELS[surface]}</span>
                                    </TooltipTrigger>
                                    {/* Why the reviewer is being asked about a surface they may not
                                        have noticed — a permission and a call, with no visible UI. */}
                                    <TooltipContent>Detected from {evidence}</TooltipContent>
                                </Tooltip>
                                {/* What to actually do. Two reviewers who interpret a surface
                                    differently make the column unusable, and "page interaction"
                                    is not self-explanatory. */}
                                <p className="text-xs leading-snug text-muted-foreground">{SURFACE_HINTS[surface]}</p>
                                <p className="text-xs text-muted-foreground/60">{evidence}</p>
                            </div>
                            <div className="flex gap-1">
                                {STATUSES.map(({ value, label, icon: Icon, tone }) => (
                                    <Tooltip key={value}>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label={`${SURFACE_LABELS[surface]}: ${label}`}
                                                aria-pressed={status === value}
                                                onClick={() => onChange(surface, { status: value })}
                                                className={cn(
                                                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                                                    status === value
                                                        ? `border-current bg-secondary ${tone}`
                                                        : "border-transparent text-muted-foreground hover:bg-secondary/60",
                                                )}
                                            >
                                                <Icon className="size-4 shrink-0" />
                                                {/* Five near-identical glyphs are a poor target for
                                                    something clicked hundreds of times in a pass. */}
                                                <span className="hidden @2xl:inline">{label}</span>
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>{label}</TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                        {/* A note is only worth asking for once something is wrong: that is when
                            the reason stops being recoverable from the status alone. */}
                        {status === "broken" || status === "partial" || status === "not_testable" ? (
                            <Input
                                value={result?.note ?? ""}
                                onChange={(e) => onChange(surface, { note: e.target.value })}
                                placeholder={status === "not_testable" ? "Why can't it be tested?" : "What was wrong?"}
                                className="h-8"
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
