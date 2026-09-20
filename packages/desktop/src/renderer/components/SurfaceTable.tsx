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
// Subpaths, not the package barrel: the barrel reaches node:crypto and cannot be bundled.
import { probeUrls } from "@extlens/analyzer/match-patterns";
import { listenersBySurface } from "@extlens/analyzer/surfaces";
import { ExternalLink, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CircleSlash, CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd, KbdHint } from "@/components/ui/kbd";
import { useHotkeys } from "@/lib/hotkeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SourceLink } from "./shared";

/**
 * The four answers a reviewer can give. "Untested" is not one of them: it is the absence of an
 * answer — nothing pressed — and offering it as a button beside "Can't test" made two controls for
 * what reads as one question. Both are excluded from the score; only one is a thing you say.
 */
const STATUSES: { value: SurfaceStatus; label: string; icon: React.ElementType; tone: string }[] = [
    { value: "working", label: "Works", icon: CheckCircle2, tone: "text-green" },
    { value: "partial", label: "Partly works", icon: CircleAlert, tone: "text-yellow" },
    { value: "broken", label: "Broken", icon: XCircle, tone: "text-red" },
    { value: "not_testable", label: "Can't test", icon: CircleSlash, tone: "text-blue" },
];

export function SurfaceTable({
    detected,
    results,
    onChange,
    contentScriptMatches = [],
    onOpenUrl,
    onOpenSource,
    listeners = [],
    readOnly = false,
    focused = null,
    onFocusRow,
    hotkeys = false,
}: {
    /** The row the number keys judge, when the form is being driven from the keyboard. */
    focused?: UiSurface | null;
    /** Clicking a row moves the keyboard cursor there, so mouse and keys agree on "this one". */
    onFocusRow?: (surface: UiSurface) => void;
    /** Show the key hints, and let `t` start the idle timer. The form binds the rest. */
    hotkeys?: boolean;
    /** Open a listener's file at its line in Code mode; omitted where that is not wired up. */
    onOpenSource?: (path: string, line: number | null) => void;
    detected: DetectedSurface[];
    results: SurfaceResult[];
    onChange: (surface: UiSurface, patch: Partial<SurfaceResult>) => void;
    /** Match patterns from the manifest, turned into pages the reviewer can open. */
    contentScriptMatches?: string[];
    onOpenUrl?: (url: string) => void;
    /** Show what was recorded without offering to change it. */
    readOnly?: boolean;
    /** Detected listeners, shown under the surface each one exercises. */
    listeners?: { api: string; file: string; line: number | null; kind?: "listener" | "call" }[];
}) {
    if (detected.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                No user-facing surfaces detected. If this extension clearly has UI, the host may be serving
                profiles from an older build — restart it.
            </p>
        );
    }

    const bySurface = listenersBySurface(listeners);

    return (
        /*
         * A container query, not a viewport one: this table renders both in the narrow browse
         * aside and in the wide review column, and which of those it is in has nothing to do with
         * the window size. Labels appear when the table itself has room for them.
         */
        <div className="@container divide-y overflow-hidden rounded-md border">
            {detected.map(({ surface, evidence }) => {
                const result = results.find((r) => r.surface === surface);
                const status = result?.status ?? "untested";
                const isFocused = focused === surface;
                return (
                    <div
                        key={surface}
                        onClick={() => onFocusRow?.(surface)}
                        className={cn(
                            // The rule is always there, transparent when the row is not the one:
                            // a border that appears on focus shifts every line in the row by its
                            // width, and a form that twitches as the cursor moves is worse than one
                            // with no cursor.
                            "space-y-2 border-l-2 border-l-transparent p-3 transition-colors",
                            isFocused && "border-l-primary bg-secondary/30",
                        )}
                    >
                        {/* Stacked until the row is wide enough to hold both: at narrow widths the
                            status buttons used to overlap the surface name. */}
                        <div className="flex flex-col gap-2 @4xl:flex-row @4xl:items-start @4xl:justify-between @4xl:gap-3">
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
                                {surface === "page_interaction" ? (
                                    <PageTargets matches={contentScriptMatches} onOpenUrl={onOpenUrl} />
                                ) : null}
                                {surface === "background" ? <IdleTimer hotkey={hotkeys} /> : null}
                                {/* The events this surface runs on. Not rows to judge — you cannot
                                    watch a listener fire — but the concrete things to trigger. */}
                                {(bySurface.get(surface) ?? []).length > 0 ? (
                                    <ul className="pt-1">
                                        {(bySurface.get(surface) ?? []).map((l) => (
                                            <li key={`${l.api}:${l.file}:${l.line}`} className="truncate">
                                                {/* "creates" is a thing to go and look for; "on" is
                                                    a thing to trigger. */}
                                                <span className="text-xs text-muted-foreground/50">
                                                    {l.kind === "call" ? "creates" : "on"}{" "}
                                                </span>
                                                <span className="font-mono text-xs text-muted-foreground/70">
                                                    {l.api}{" "}
                                                    <SourceLink
                                                        file={l.file}
                                                        line={l.line}
                                                        onOpenSource={onOpenSource}
                                                        className="text-muted-foreground/50"
                                                    />
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1 @4xl:shrink-0 @4xl:flex-nowrap">
                                {STATUSES.map(({ value, label, icon: Icon, tone }, i) => (
                                    <Tooltip key={value}>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label={`${SURFACE_LABELS[surface]}: ${label}`}
                                                aria-pressed={status === value}
                                                disabled={readOnly}
                                                onClick={() => onChange(surface, { status: value })}
                                                className={cn(
                                                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                                                    status === value
                                                        ? `border-current bg-secondary ${tone}`
                                                        : "border-transparent text-muted-foreground",
                                                    // Read-only keeps the chosen state legible and drops the
                                                    // affordances: no hover, no pointer, nothing to click at.
                                                    readOnly
                                                        ? status !== value && "opacity-40"
                                                        : status !== value && "hover:bg-secondary/60",
                                                )}
                                            >
                                                <Icon className="size-4 shrink-0" />
                                                {/* Five near-identical glyphs are a poor target for
                                                    something clicked hundreds of times in a pass. */}
                                                <span>{label}</span>
                                                {/* On every row, so the buttons never move as the
                                                    cursor does; lit only where the key will land. */}
                                                {hotkeys ? (
                                                    <KbdHint className={cn(!isFocused && "opacity-30")}>{i + 1}</KbdHint>
                                                ) : null}
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {label}
                                            {hotkeys ? (
                                                <>
                                                    {" "}
                                                    <Kbd>{i + 1}</Kbd> on the highlighted row
                                                </>
                                            ) : null}
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                        {/* A note is only worth asking for once something is wrong: that is when
                            the reason stops being recoverable from the status alone. */}
                        {status === "broken" || status === "partial" || status === "not_testable" ? (
                            readOnly ? (
                                result?.note ? <p className="text-xs text-muted-foreground">{result.note}</p> : null
                            ) : (
                                <Input
                                    value={result?.note ?? ""}
                                    onChange={(e) => onChange(surface, { note: e.target.value })}
                                    placeholder={status === "not_testable" ? "Why can't it be tested?" : "What was wrong?"}
                                    className="h-8"
                                />
                            )
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * The pages a content script claims to run on, as buttons that open them in the test browsers.
 *
 * Asking "does page interaction work?" without saying where to look is most of why that surface
 * gets guessed at. Opening the page in both browsers at once is also the only way to compare MV2
 * and MV3 behaviour rather than remember it.
 */
function PageTargets({ matches, onOpenUrl }: { matches: string[]; onOpenUrl?: (url: string) => void }) {
    const targets = probeUrls(matches);
    if (targets.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-1 pt-1">
            {targets.map(({ pattern, url }) =>
                url ? (
                    <Button
                        key={pattern}
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs font-normal"
                        title={`Open ${url} in the running test browsers (from ${pattern})`}
                        onClick={() => onOpenUrl?.(url)}
                        disabled={!onOpenUrl}
                    >
                        <ExternalLink className="size-3" />
                        {url.replace(/^https?:\/\//, "")}
                    </Button>
                ) : (
                    // A pattern naming no particular site is still worth stating: "runs everywhere"
                    // is a thing to check, not a gap in the data.
                    <span
                        key={pattern}
                        title={`${pattern} — no single page represents this; try any site you would normally use`}
                        className="rounded border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                        any page ({pattern})
                    </span>
                ),
            )}
        </div>
    );
}

/**
 * How long Chrome waits before stopping an idle MV3 service worker. The hint says "~30s"; this
 * is what the timer counts, so the two must agree.
 */
const IDLE_SECONDS = 30;

/**
 * A countdown for the "survives idle" check. The wait is the whole test, and a reviewer who
 * guesses at 30 seconds — or wanders off and comes back at 20 — has not run it. Counting it down
 * here makes the pass the same length every time, and says when it is over.
 */
function IdleTimer({ hotkey = false }: { hotkey?: boolean }) {
    // null: not started. 0: elapsed. Otherwise seconds remaining.
    const [remaining, setRemaining] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (remaining === null || remaining === 0) return;
        const id = window.setTimeout(() => setRemaining(remaining - 1), 1000);
        return () => window.clearTimeout(id);
    }, [remaining]);

    const running = remaining !== null && remaining > 0;
    const start = () => setRemaining(IDLE_SECONDS);
    useHotkeys(hotkey && !running, { t: start });

    return (
        <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs font-normal tabular-nums"
                title={`Count down ${IDLE_SECONDS}s of idle time, then use the surface again`}
                disabled={running}
                onClick={start}
            >
                <Timer className="size-3" />
                {running ? `${remaining}s` : `Start ${IDLE_SECONDS}s timer`}
                {hotkey && !running ? <KbdHint>t</KbdHint> : null}
            </Button>
            {running ? <span className="text-xs text-muted-foreground">Leave that browser alone…</span> : null}
            {remaining === 0 ? (
                <span className="text-xs text-green">Idle long enough — use the surface again now.</span>
            ) : null}
        </div>
    );
}
