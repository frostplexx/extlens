/**
 * Review mode: one extension at a time, with the queue doing the bookkeeping.
 *
 * Browsing a table and reviewing a corpus are different jobs. Reviewing is a loop — launch the
 * browsers, click around, record what you saw, move on — and the table shape makes you re-find
 * your place after every save. Here the position is the view's own state, saving advances it, and
 * the only decisions left are about the extension in front of you.
 *
 * Everything on screen is one of three things: where you are in the pass, what you need in order
 * to judge this extension, and the verdict. Anything else belongs in browse mode.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import type { ExtensionProfile, FileRefs, Report, ReportDraft } from "@extlens/protocol";
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    Download,
    MonitorPlay,
    PartyPopper,
    SquareX,
    TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReviewQueue } from "../hooks/useReviewQueue";
import { QUEUE_FILTERS } from "../hooks/useReviewQueue";
import type { LocalSnapshot } from "../types";
import { Mono, PhaseBadge, ScoreBar, prettyTag } from "./shared";
import { ReportForm } from "./ReportForm";
import type { ExplainFn } from "./ExplainCard";

export function ReviewView({
    queue,
    profile,
    files,
    report,
    profileLoading,
    profileError,
    local,
    autoLaunch,
    onAutoLaunchChange,
    onLaunch,
    onCloseBrowsers,
    onAnswerPrompt,
    onSubmitReport,
    submitting,
    submitError,
    onExit,
    onOpenUrl,
    onOpenSource,
    onExplain,
}: {
    onOpenSource?: (path: string, line: number | null) => void;
    onExplain?: ExplainFn;
    queue: ReviewQueue;
    profile: ExtensionProfile | null;
    files: FileRefs | null;
    report: Report | null;
    profileLoading: boolean;
    profileError: string | null;
    local: LocalSnapshot;
    autoLaunch: boolean;
    onAutoLaunchChange: (value: boolean) => void;
    onLaunch: () => void;
    onCloseBrowsers: () => void;
    onAnswerPrompt: (accept: boolean) => void;
    onSubmitReport: (draft: ReportDraft) => void;
    submitting: boolean;
    submitError: string | null;
    onExit: () => void;
    onOpenUrl?: (url: string) => void;
}) {
    /**
     * Auto-launch fires once per extension, and only once the loaded profile is that extension's.
     *
     * Both conditions were learned the hard way. Without the id key it re-fires on unrelated
     * renders, and launching Chrome twice is not a harmless repeat. Without the profile check it
     * fires while `files` still points at the PREVIOUS extension — which opened the wrong
     * extension in both browsers while the pane displayed the right one, and then never corrected
     * itself, because the id had already been marked as launched.
     */
    const launchedFor = useRef<string | null>(null);
    const subjectId = queue.current?.id ?? null;
    const ready = Boolean(subjectId && files && profile && profile.id === subjectId);
    useEffect(() => {
        if (!autoLaunch || !ready || !subjectId) return;
        if (launchedFor.current === subjectId) return;
        launchedFor.current = subjectId;
        onLaunch();
    }, [autoLaunch, ready, subjectId, onLaunch]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <QueueBar queue={queue} autoLaunch={autoLaunch} onAutoLaunchChange={onAutoLaunchChange} onExit={onExit} />

            {!queue.current ? (
                <QueueEmpty queue={queue} onExit={onExit} />
            ) : profileLoading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                </div>
            ) : profileError || !profile ? (
                <Empty className="flex-1">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <TriangleAlert />
                        </EmptyMedia>
                        <EmptyTitle>Could not load {queue.current.name}</EmptyTitle>
                        <EmptyDescription>{profileError ?? "The host returned no profile."}</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={queue.next}>
                        Skip to the next one
                        <ArrowRight className="size-4" />
                    </Button>
                </Empty>
            ) : (
                /*
                 * The point of this window is to sit beside two browser windows, so it spends most
                 * of its life narrow. Below `lg` the subject pane stops being a column and becomes
                 * a collapsible strip above the form: the form is the thing being filled in, and it
                 * gets the width.
                 */
                <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:grid lg:grid-cols-[minmax(0,20rem)_1fr] lg:overflow-hidden">
                    <Subject profile={profile} report={report} />
                    <div className="flex min-h-0 flex-col lg:overflow-hidden">
                        <BrowserBar
                            local={local}
                            files={files}
                            onLaunch={onLaunch}
                            onCloseBrowsers={onCloseBrowsers}
                            onAnswerPrompt={onAnswerPrompt}
                        />
                        <Separator />
                        <div className="min-h-0 flex-1 p-4 lg:overflow-auto lg:p-5">
                            <ReportForm
                                profile={profile}
                                saved={report}
                                onSubmit={onSubmitReport}
                                submitting={submitting}
                                error={submitError}
                                onOpenUrl={onOpenUrl}
                                onOpenSource={onOpenSource}
                                onExplain={onExplain}
                                readOnly={false}
                                submitLabel={queue.hasNext ? "Save & next" : "Save & finish"}
                                footer={
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="ghost" onClick={queue.next} disabled={!queue.hasNext}>
                                                Skip
                                                <ArrowRight className="size-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            Move on without recording anything. <Kbd>]</Kbd>
                                        </TooltipContent>
                                    </Tooltip>
                                }
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Where you are in the pass, and the two settings that change how the pass runs. */
function QueueBar({
    queue,
    autoLaunch,
    onAutoLaunchChange,
    onExit,
}: {
    queue: ReviewQueue;
    autoLaunch: boolean;
    onAutoLaunchChange: (value: boolean) => void;
    onExit: () => void;
}) {
    const done = queue.reviewed.size;
    // The denominator grows as pages load, so it is stated as "of N so far" rather than pretending
    // to be final — a progress bar that silently re-scales is worse than one that admits it.
    const total = queue.length;
    return (
        /*
         * Wraps rather than overflows. Every control here is used during a pass — the filter and
         * auto-launch decide what the pass IS — so a narrow window costs a second row, never a
         * hidden control. Labels go first, the controls themselves never.
         */
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 lg:h-16 lg:flex-nowrap lg:gap-5 lg:px-5 lg:py-0">
            <Button variant="ghost" size="sm" onClick={onExit}>
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">Back to browse</span>
            </Button>

            <Separator orientation="vertical" className="hidden h-8 lg:block" />

            <div className="flex min-w-40 flex-1 flex-col gap-1 lg:min-w-56 lg:flex-none">
                <div className="flex items-baseline gap-2 whitespace-nowrap text-sm">
                    <span className="font-medium tabular-nums">
                        {queue.position} / {total}
                        {queue.moreToLoad ? "+" : ""}
                    </span>
                    <span className="truncate text-muted-foreground">
                        {done} reviewed
                        <span className="hidden xl:inline"> this pass</span>
                        {queue.loading ? " · loading…" : ""}
                    </span>
                </div>
                <Progress value={total === 0 ? 0 : (queue.position / total) * 100} />
            </div>

            <Select value={queue.filter} onValueChange={(value) => queue.setFilter(value as typeof queue.filter)}>
                <SelectTrigger className="w-44 lg:w-56">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {QUEUE_FILTERS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                            {f.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
                <Switch id="auto-launch" checked={autoLaunch} onCheckedChange={onAutoLaunchChange} />
                <Label htmlFor="auto-launch" className="cursor-pointer font-normal">
                    <span className="lg:hidden">Auto-launch</span>
                    <span className="hidden lg:inline">Launch browsers automatically</span>
                </Label>
            </div>

            <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={queue.previous} disabled={!queue.hasPrevious}>
                    <ArrowLeft className="size-4" />
                    <Kbd>[</Kbd>
                </Button>
                <Button variant="outline" size="sm" onClick={queue.next} disabled={!queue.hasNext}>
                    <Kbd>]</Kbd>
                    <ArrowRight className="size-4" />
                </Button>
            </div>
        </div>
    );
}

/** What you need in order to judge this extension — and nothing you do not. */
function Subject({ profile, report }: { profile: ExtensionProfile; report: Report | null }) {
    return (
        <aside className="shrink-0 border-b bg-card/40 lg:min-h-0 lg:overflow-auto lg:border-b-0 lg:border-r lg:p-5">
            {/*
             * Which extension am I judging? The narrow layout scrolls the whole column, so an
             * unpinned title slides away the moment the reviewer reaches the surfaces — and a form
             * with no subject on screen is how the wrong extension gets a report. Pinned as one
             * compact line while narrow; the full header returns once there is a column for it.
             */}
            <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b bg-card px-4 py-2 lg:static lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-0">
                <h2 className="min-w-0 truncate text-lg font-semibold leading-tight" title={profile.name}>
                    {profile.name}
                </h2>
                <span className="shrink-0 text-sm text-muted-foreground lg:hidden">v{profile.version ?? "?"}</span>
                <Badge variant={profile.manifestVersion === 3 ? "default" : "secondary"} className="shrink-0 lg:hidden">
                    MV{profile.manifestVersion}
                </Badge>
                <ScoreBar score={profile.score} className="ml-auto shrink-0 lg:hidden" />
            </div>

            <div className="px-4 pb-4 lg:px-0 lg:pb-0">
            <div className="mt-1 hidden flex-wrap items-center gap-2 text-sm text-muted-foreground lg:flex">
                <span>v{profile.version ?? "?"}</span>
                <Badge variant={profile.manifestVersion === 3 ? "default" : "secondary"}>
                    MV{profile.manifestVersion}
                </Badge>
                {report ? (
                    <Badge variant="outline" className="text-green">
                        already reviewed
                    </Badge>
                ) : null}
            </div>
            {profile.manifest.description ? (
                <p className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground lg:line-clamp-none">
                    {profile.manifest.description}
                </p>
            ) : null}
            <div className="mt-3 hidden items-baseline gap-2 lg:flex">
                <ScoreBar score={profile.score} />
                <span className="text-xs text-muted-foreground">interestingness</span>
            </div>

            {/* Tags and manifest facts are reference, not action: worth a column when there is one,
                and worth folding away when the window is sharing the screen with two browsers. */}
            <div className="hidden lg:block">
            {profile.tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1">
                    {profile.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="font-normal text-muted-foreground">
                            {prettyTag(tag)}
                        </Badge>
                    ))}
                </div>
            ) : null}

            <Separator className="my-4" />

            {/* The three manifest facts that decide what to click, spelled out; the rest is a tab
                away in browse mode and would only be noise here. */}
            <dl className="space-y-2 text-sm">
                <Fact label="Popup" value={profile.manifest.action?.defaultPopup} />
                <Fact label="Options page" value={profile.manifest.optionsPage} />
                <Fact label="New tab" value={profile.manifest.chromeUrlOverrides.newtab} />
                <Fact
                    label="Permissions"
                    value={profile.manifest.permissions.join(", ") || null}
                    wrap
                />
            </dl>
            </div>
            </div>
        </aside>
    );
}

function Fact({ label, value, wrap = false }: { label: string; value: string | null | undefined; wrap?: boolean }) {
    return (
        <div className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={wrap ? "min-w-0 break-words" : "truncate"}>
                {value ? <Mono>{value}</Mono> : <span className="text-muted-foreground">—</span>}
            </dd>
        </div>
    );
}

/** The launch controls, kept at the top of the working column where the loop starts. */
function BrowserBar({
    local,
    files,
    onLaunch,
    onCloseBrowsers,
    onAnswerPrompt,
}: {
    local: LocalSnapshot;
    files: FileRefs | null;
    onLaunch: () => void;
    onCloseBrowsers: () => void;
    onAnswerPrompt: (accept: boolean) => void;
}) {
    const prompt = local.prompts[0];
    const busy = Object.values(local.browsers).some((b) => b.phase === "launching" || b.phase === "downloading");

    return (
        <div className="shrink-0 space-y-3 p-4 lg:p-5">
            <div className="flex flex-wrap items-center gap-2">
                <Button onClick={onLaunch} disabled={!files || busy}>
                    {busy ? <Spinner /> : <MonitorPlay className="size-4" />}
                    Launch browsers
                </Button>
                <Button variant="secondary" onClick={onCloseBrowsers}>
                    <SquareX className="size-4" />
                    Close
                </Button>
                <span className="hidden text-xs text-muted-foreground xl:inline">
                    <Kbd>b</Kbd> launch · <Kbd>x</Kbd> close
                </span>
            </div>

            <ItemGroup className="gap-2">
                {(["mv2", "mv3"] as const).map((label) => {
                    const state = local.browsers[label];
                    return (
                        // flex-nowrap with a min-w-0 body: Item wraps by default, which at narrow
                        // widths let the phase badge land on top of the message text.
                        <Item key={label} variant="outline" size="sm" className="flex-nowrap gap-2">
                            <ItemMedia className="shrink-0">
                                <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
                            </ItemMedia>
                            <ItemContent className="min-w-0 flex-1">
                                <ItemTitle className="block truncate text-xs text-muted-foreground">
                                    {state.message ?? (files?.[label] ?? "no files for this variant")}
                                </ItemTitle>
                            </ItemContent>
                            <ItemActions className="shrink-0">
                                <PhaseBadge phase={state.phase} />
                            </ItemActions>
                        </Item>
                    );
                })}
            </ItemGroup>

            {prompt ? (
                <div className="space-y-2 rounded-md border border-peach/40 bg-peach/10 p-3">
                    <p className="text-sm text-peach">{prompt.message}</p>
                    <p className="text-xs text-muted-foreground">
                        Download Chrome for Testing into <Mono>{local.browserDir}</Mono>?
                    </p>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => onAnswerPrompt(true)}>
                            <Download className="size-4" />
                            Download
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onAnswerPrompt(false)}>
                            Skip
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function QueueEmpty({ queue, onExit }: { queue: ReviewQueue; onExit: () => void }) {
    if (queue.loading) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
            </div>
        );
    }
    const finished = queue.length > 0;
    return (
        <Empty className="flex-1">
            <EmptyHeader>
                <EmptyMedia variant="icon">{finished ? <PartyPopper /> : <CheckCircle2 />}</EmptyMedia>
                <EmptyTitle>{finished ? "That is the whole queue" : "Nothing to review"}</EmptyTitle>
                <EmptyDescription>
                    {finished
                        ? `${queue.reviewed.size} reviewed in this pass.`
                        : "Every extension matching this filter already has a report. Try a wider filter."}
                </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={onExit}>
                <ArrowLeft className="size-4" />
                Back to browse
            </Button>
        </Empty>
    );
}
