/**
 * App-level pieces built on the shadcn primitives in components/ui.
 *
 * The rule: anything generic enough to be in a component library stays in ui/ untouched, so it can
 * be regenerated; anything that encodes something about *extensions* — what a score means, what a
 * browser phase looks like — lives here.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Score → colour. The same thresholds as the terminal client, so the two agree at a glance. */
export function scoreTone(score: number): { text: string; bar: string } {
    if (score >= 70) return { text: "text-green", bar: "bg-green" };
    if (score >= 40) return { text: "text-yellow", bar: "bg-yellow" };
    return { text: "text-red", bar: "bg-red" };
}

export function ScoreBar({ score, className }: { score: number; className?: string }) {
    const tone = scoreTone(score);
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <span className={cn("w-7 text-right text-sm font-semibold tabular-nums", tone.text)}>{score}</span>
            <div className="h-1.5 w-full max-w-20 overflow-hidden rounded-full bg-secondary">
                <div
                    className={cn("h-full rounded-full transition-all", tone.bar)}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
            </div>
        </div>
    );
}

/** A labelled statistic for the toolbar. */
export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
            <span className="text-sm font-medium tabular-nums">{value}</span>
        </div>
    );
}

/** Monospace for the things that are literally identifiers: ids, paths, api names, log lines. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
    return <span className={cn("font-mono text-xs", className)}>{children}</span>;
}

const PHASE_STYLES: Record<string, string> = {
    idle: "bg-secondary text-muted-foreground",
    launching: "bg-peach/15 text-peach",
    detecting: "bg-peach/15 text-peach",
    downloading: "bg-peach/15 text-peach",
    loaded: "bg-green/15 text-green",
    failed: "bg-destructive/15 text-destructive",
    closed: "bg-secondary text-muted-foreground",
};

export function PhaseBadge({ phase }: { phase: string }) {
    return (
        <Badge variant="secondary" className={cn("border-transparent font-normal", PHASE_STYLES[phase])}>
            {phase}
        </Badge>
    );
}

/** Key/value row for the manifest and profile panes. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[9rem_1fr] gap-3 py-1 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{children}</dd>
        </div>
    );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-10 text-center">
            <p className="text-sm text-muted-foreground">{title}</p>
            {hint ? <p className="text-xs text-muted-foreground/70">{hint}</p> : null}
        </div>
    );
}
