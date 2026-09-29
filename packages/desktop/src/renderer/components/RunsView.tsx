/**
 * Past runs: what has been tried, and which one is on screen.
 *
 * The list is the history of the experiment, so each row leads with the two things that identify a
 * run — its model and when it ran — and then with how far it got. Progress is three numbers rather
 * than one because they answer different questions: how many extensions have a migration at all, how
 * many the harness verified, and how many a human has actually reviewed. A run of 200 extensions with
 * 200 migrated and 4 reviewed is a very different state from one with 4 of each.
 *
 * Opening a run re-points the host at it, so the row is a destination and not a detail: the table,
 * the reports and the transcripts all change with it. Deleting one is permanent and says so; the run
 * being served cannot be deleted at all, which is the host's rule and is shown rather than explained.
 */
import * as React from "react";
import { useState } from "react";
import type { RunInfo } from "@extlens/protocol";
import { ArrowLeft, Check, Cpu, FolderOpen, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunsState } from "../hooks/useRuns";
import { Mono } from "./shared";
import { cn } from "@/lib/utils";

export function RunsView({
    runs,
    onExit,
    onNewRun,
    /** A migration is running: the host refuses to re-point or delete under it. */
    running,
}: {
    runs: RunsState;
    onExit: () => void;
    onNewRun: () => void;
    running: boolean;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 lg:px-5">
                <Button variant="ghost" size="sm" onClick={onExit}>
                    <ArrowLeft className="size-4" />
                    <span className="hidden sm:inline">Back</span>
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <h2 className="text-sm font-semibold">Runs</h2>
                <span className="text-xs text-muted-foreground">
                    {runs.runs.length} run{runs.runs.length === 1 ? "" : "s"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="icon-sm" onClick={runs.reload} title="Reload">
                        <RefreshCw className="size-4" />
                    </Button>
                    <Button size="sm" onClick={onNewRun} disabled={runs.busy}>
                        <Plus className="size-4" />
                        New run
                    </Button>
                </div>
            </div>

            {runs.error ? (
                <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{runs.error}</p>
            ) : null}

            {runs.runs.length === 0 ? (
                <Empty className="flex-1">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Layers />
                        </EmptyMedia>
                        <EmptyTitle>No runs yet</EmptyTitle>
                        <EmptyDescription>
                            A run is one model over one corpus. Create one and it becomes what this window shows.
                        </EmptyDescription>
                    </EmptyHeader>
                    <Button onClick={onNewRun}>
                        <Plus className="size-4" />
                        New run
                    </Button>
                </Empty>
            ) : (
                <ScrollArea className="min-h-0 flex-1">
                    <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-4">
                        {runs.runs.map((run) => (
                            <RunRow
                                key={run.id}
                                run={run}
                                disabled={runs.busy || running}
                                onOpen={() => runs.select(run.id)}
                                onDelete={() => runs.remove(run.id)}
                            />
                        ))}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}

function RunRow({
    run,
    disabled,
    onOpen,
    onDelete,
}: {
    run: RunInfo;
    disabled: boolean;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const [confirming, setConfirming] = useState(false);
    const created = new Date(run.createdAt);
    const thinking = run.settings.LLM_THINKING;
    const ctx = run.settings.LLM_NUM_CTX ? Number(run.settings.LLM_NUM_CTX) : null;

    return (
        <article
            className={cn(
                "rounded-md border px-3 py-2",
                run.active ? "border-l-2 border-l-green bg-card/60" : "bg-card/30",
            )}
        >
            <header className="flex min-w-0 items-center gap-2">
                <Cpu className={cn("size-4 shrink-0", run.active ? "text-green" : "text-muted-foreground")} />
                <span className="min-w-0 truncate text-sm font-medium">{run.model}</span>
                {run.active ? (
                    <Badge variant="outline" className="shrink-0 font-normal text-green">
                        <Check className="size-3" />
                        showing
                    </Badge>
                ) : null}
                {run.label ? (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{run.label}</span>
                ): null}
                <time
                    dateTime={run.createdAt}
                    title={created.toLocaleString()}
                    className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                    {created.toLocaleString()}
                </time>
            </header>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {/* Three numbers, not one: they answer different questions. */}
                <span className="tabular-nums">
                    <span className="font-medium text-foreground">{run.extensions}</span> migrated
                </span>
                <span className="tabular-nums">
                    <span className="font-medium text-foreground">{run.migrated}</span> verified
                </span>
                <span className="tabular-nums">
                    <span className="font-medium text-foreground">{run.reviewed}</span> reviewed
                </span>
                {thinking && thinking !== "off" ? <span>thinking {thinking}</span> : null}
                {ctx ? <span className="tabular-nums">{Math.round(ctx / 1024)}k ctx</span> : null}
            </div>

            <div className="mt-1 flex min-w-0 items-center gap-2">
                <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate" title={run.corpus}>
                    <Mono className="text-xs text-muted-foreground">{run.corpus}</Mono>
                </span>
                <Mono className="ml-auto shrink-0 text-xs text-muted-foreground/70">{run.id}</Mono>
            </div>

            <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant={run.active ? "ghost" : "outline"} disabled={disabled || run.active} onClick={onOpen}>
                    {run.active ? "Showing" : "Open"}
                </Button>
                {confirming ? (
                    <>
                        <span className="text-xs text-destructive">
                            Delete this run's migrations, reports and transcripts?
                        </span>
                        <Button size="sm" variant="destructive" disabled={disabled} onClick={onDelete}>
                            Delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                            Keep
                        </Button>
                    </>
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Delete run"
                                // The served run cannot be deleted; the host refuses it, so the button
                                // says so rather than offering an action that will fail.
                                disabled={disabled || run.active}
                                onClick={() => setConfirming(true)}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {run.active ? "Open another run before deleting this one" : "Delete this run for good"}
                        </TooltipContent>
                    </Tooltip>
                )}
                {disabled ? <Spinner className="size-4 text-muted-foreground" /> : null}
            </div>
        </article>
    );
}
