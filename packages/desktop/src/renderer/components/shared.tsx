/**
 * App-level pieces built on the shadcn primitives in components/ui.
 *
 * The rule: anything generic enough to belong in a component library stays in ui/ untouched so it
 * can be regenerated; anything that encodes something about *extensions* — what a score means,
 * what a browser phase looks like — lives here.
 */
import * as React from "react";
import { useEffect, useState } from "react";
import type { ExtensionVerdict } from "@extlens/protocol";
import { CheckCircle2, CircleAlert, CircleSlash, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { BrowserLabel, LocalSnapshot } from "../types";

/**
 * A score, as a number.
 *
 * It used to come with a bar and a colour, and both lied. The bar was a `Progress` fed the raw
 * score, which clamps at 100 — and interestingness is an unbounded weighted sum that reaches the
 * thousands, so every bar in a list was full-length regardless of value. The colour came from
 * thresholds at 70 and 40, which on that scale means everything is green.
 *
 * A number that is right beats a graphic that is wrong. Making the magnitude scannable again needs
 * a range to scale against — the corpus maximum, or a percentile — which the client does not have
 * today; until it does, this says exactly what it knows.
 */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
    return (
        <span className={cn("text-sm font-semibold tabular-nums text-foreground", className)}>
            {score.toLocaleString()}
        </span>
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

function formatElapsed(totalSeconds: number): string {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    return `${Math.floor(totalSeconds / 60)}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

/**
 * The one unmissable strip for the silent stretches of a launch: the ssh tar-down of the
 * extension and the browser start. The pills below carry the same state, and the Launch button
 * spins — but both are small, and a reviewer staring at the form reads neither; the report of
 * a wedged client was always a download nobody could see. Says what is happening, for which
 * variant, and that it is still moving (elapsed seconds tick).
 */
export function DownloadNotice({ local, subject }: { local: LocalSnapshot; subject?: string }) {
    const key = (Object.keys(local.browsers) as BrowserLabel[])
        .filter((label) => {
            const phase = local.browsers[label].phase;
            return phase === "downloading" || phase === "launching";
        })
        .join("|");
    const [since, setSince] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!key) {
            setSince(null);
            return;
        }
        setSince((s) => s ?? Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [key]);
    if (!key) return null;
    const seconds = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
    const labels = key.split("|").map((label) => label.toUpperCase()).join(" + ");
    const downloading = key.split("|").some((label) => local.browsers[label as BrowserLabel].phase === "downloading");
    return (
        <div className="flex items-center gap-2 rounded-md border border-peach/40 bg-peach/10 px-3 py-2 text-sm text-peach">
            <Spinner className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
                {downloading ? (
                    <>
                        Downloading <strong className="font-medium">{subject ?? "extension"}</strong> ({labels}) over ssh…{" "}
                        <span className="tabular-nums">{formatElapsed(seconds)}</span>
                    </>
                ) : (
                    <>
                        Starting {labels} browser… <span className="tabular-nums">{formatElapsed(seconds)}</span>
                    </>
                )}
                <span className="text-muted-foreground"> — it opens on its own when ready.</span>
            </span>
        </div>
    );
}

/** SHOUTING_SNAKE_CASE is the analyzer's internal identifier, not a label for a reader. */
export function prettyTag(tag: string): string {
    return tag.toLowerCase().replace(/_/g, " ");
}

/**
 * A `file:line` that opens the code, when there is somewhere to open it.
 *
 * The analyzer's locations used to be printed and left there — a path you had to go and find by
 * hand. With Code mode they are the fastest way in, so they are links whenever a handler exists,
 * and stay plain text when the caller has none (a form embedded somewhere without the mode).
 */
export function SourceLink({
    file,
    line,
    onOpenSource,
    className,
}: {
    file: string;
    line: number | null;
    onOpenSource?: (path: string, line: number | null) => void;
    className?: string;
}) {
    const label = line ? `${file}:${line}` : file;
    if (!onOpenSource) return <Mono className={cn("text-muted-foreground", className)}>{label}</Mono>;
    return (
        <button
            type="button"
            className={cn(
                "cursor-pointer rounded-sm font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none",
                className,
            )}
            onClick={(e) => {
                e.stopPropagation();
                onOpenSource(file, line);
            }}
            title="Open in Code mode"
        >
            {label}
        </button>
    );
}

/**
 * How a verdict looks: one glyph, one colour, everywhere it appears.
 *
 * The table's result column and the filter that narrows it are the same vocabulary seen twice, and
 * a reader picking "partially working" out of a menu is looking for the glyph they just saw in a
 * row. Keeping the pair here is what makes those two places impossible to drift apart.
 */
export const VERDICT_TONE: Record<ExtensionVerdict, string> = {
    working: "text-green",
    partially_working: "text-yellow",
    not_working: "text-red",
    not_testable: "text-blue",
};

export const VERDICT_ICON: Record<ExtensionVerdict, React.ElementType> = {
    working: CheckCircle2,
    partially_working: CircleAlert,
    not_working: XCircle,
    not_testable: CircleSlash,
};
