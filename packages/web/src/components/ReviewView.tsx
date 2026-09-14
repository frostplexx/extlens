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
}: {
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
}) {
    /**
     * Auto-launch fires once per extension, keyed on the id whose files have arrived. Without the
     * key it would re-fire on every unrelated render — and launching Chrome twice is not a
     * harmless repeat.
     */
    const launchedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!autoLaunch || !queue.current || !files) return;
        if (launchedFor.current === queue.current.id) return;
        launchedFor.current = queue.current.id;
        onLaunch();
    }, [autoLaunch, queue.current?.id, files, onLaunch]);

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
                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,22rem)_1fr] overflow-hidden">
                    <Subject profile={profile} report={report} />
                    <div className="flex min-h-0 flex-col overflow-hidden">
                        <BrowserBar
                            local={local}
                            files={files}
                            onLaunch={onLaunch}
                            onCloseBrowsers={onCloseBrowsers}
                            onAnswerPrompt={onAnswerPrompt}
                        />
                        <Separator />
                        <div className="min-h-0 flex-1 overflow-auto p-5">
                            <ReportForm
                                profile={profile}
                                saved={report}
                                onSubmit={onSubmitReport}
                                submitting={submitting}
                                error={submitError}
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
        <div className="flex h-16 shrink-0 items-center gap-5 border-b px-5">
            <Button variant="ghost" size="sm" onClick={onExit}>
                <ArrowLeft className="size-4" />
                Back to browse
            </Button>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex min-w-56 flex-col gap-1">
                <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium tabular-nums">
                        {queue.position} / {total}
                        {queue.moreToLoad ? "+" : ""}
                    </span>
                    <span className="text-muted-foreground">
                        {done} reviewed this pass
                        {queue.loading ? " · loading…" : ""}
                    </span>
                </div>
                <Progress value={total === 0 ? 0 : (queue.position / total) * 100} />
            </div>

            <Select value={queue.filter} onValueChange={(value) => queue.setFilter(value as typeof queue.filter)}>
                <SelectTrigger className="w-56">
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
                    Launch browsers automatically
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
        <aside className="min-h-0 overflow-auto border-r bg-card/40 p-5">
            <h2 className="text-lg font-semibold leading-tight" title={profile.name}>
                {profile.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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
            {/* The store description says what the extension is FOR, which is what tells a
                reviewer whether the thing they are looking at is the thing that should happen. */}
            {profile.manifest.description ? (
                <p className="mt-2 text-sm leading-snug text-muted-foreground">{profile.manifest.description}</p>
            ) : null}
            <ScoreBar score={profile.score} className="mt-3 max-w-48" />

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

            <Separator className="my-4" />

            <h3 className="mb-2 text-sm font-medium">Listeners ({profile.listeners.length})</h3>
            {profile.listeners.length === 0 ? (
                <p className="text-sm text-muted-foreground">None detected.</p>
            ) : (
                <ul className="space-y-1">
                    {profile.listeners.map((l) => (
                        <li key={`${l.api}:${l.file}:${l.line}`} className="truncate" title={`${l.file}:${l.line}`}>
                            <Mono>{l.api}</Mono>
                        </li>
                    ))}
                </ul>
            )}
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
        <div className="shrink-0 space-y-3 p-5">
            <div className="flex items-center gap-3">
                <Button onClick={onLaunch} disabled={!files || busy}>
                    {busy ? <Spinner /> : <MonitorPlay className="size-4" />}
                    Launch browsers
                </Button>
                <Button variant="secondary" onClick={onCloseBrowsers}>
                    <SquareX className="size-4" />
                    Close
                </Button>
                <span className="text-xs text-muted-foreground">
                    <Kbd>b</Kbd> launch · <Kbd>x</Kbd> close
                </span>
            </div>

            <ItemGroup className="gap-2">
                {(["mv2", "mv3"] as const).map((label) => {
                    const state = local.browsers[label];
                    return (
                        <Item key={label} variant="outline" size="sm">
                            <ItemMedia>
                                <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className="truncate text-xs text-muted-foreground">
                                    {state.message ?? (files?.[label] ?? "no files for this variant")}
                                </ItemTitle>
                            </ItemContent>
                            <ItemActions>
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
