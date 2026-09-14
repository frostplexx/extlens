/**
 * App-level pieces built on the shadcn primitives in components/ui.
 *
 * The rule: anything generic enough to belong in a component library stays in ui/ untouched so it
 * can be regenerated; anything that encodes something about *extensions* — what a score means,
 * what a browser phase looks like — lives here.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Score → colour. The same thresholds as the terminal client, so the two agree at a glance. */
export function scoreTone(score: number): { text: string; indicator: string } {
    if (score >= 70) return { text: "text-green", indicator: "[&_[data-slot=progress-indicator]]:bg-green" };
    if (score >= 40) return { text: "text-yellow", indicator: "[&_[data-slot=progress-indicator]]:bg-yellow" };
    return { text: "text-red", indicator: "[&_[data-slot=progress-indicator]]:bg-red" };
}

/**
 * A score as a number plus a bar.
 *
 * The bar is `Progress` recoloured through its data-slot rather than a hand-rolled div, so the
 * component stays stock and still carries its ARIA role — the number alone is the accessible
 * value, but the bar is what makes a column of scores scannable.
 */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
    const tone = scoreTone(score);
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <span className={cn("w-7 text-right text-sm font-semibold tabular-nums", tone.text)}>{score}</span>
            <Progress value={score} className={cn("w-full max-w-20", tone.indicator)} />
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

/** SHOUTING_SNAKE_CASE is the analyzer's internal identifier, not a label for a reader. */
export function prettyTag(tag: string): string {
    return tag.toLowerCase().replace(/_/g, " ");
}
