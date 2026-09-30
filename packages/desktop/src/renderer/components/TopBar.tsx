/**
 * The application bar: identity, the run controls, and where to go.
 *
 * Controls only. Standing status (which model, which host) sits in the log dock instead, where it
 * can be read without being clickable: both used to be buttons here, and the host pill was a second
 * route to the settings gear beside it.
 *
 * It is also the window's title bar, since the native one is hidden, so it is a drag region and it
 * leaves room for the window controls the OS draws over it: traffic lights on the left on macOS, the
 * overlay on the right elsewhere.
 */
import * as React from "react";
import type { HostStatus } from "@extlens/protocol";
import { ClipboardCheck, Download, Layers, Play, Plus, Settings, Square, Table2, Terminal } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { estimate } from "@/lib/eta";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { platform } from "../bridge";
import type { RunsState } from "../hooks/useRuns";
import type { AppMode } from "../types";
import { cn } from "@/lib/utils";

export function TopBar({
    host,
    onToggleHost,
    mode,
    onModeChange,
    onExport,
    exporting,
    runs,
    onNewRun,
}: {
    host: { status: HostStatus | null; supported: boolean; running: boolean; model?: string | null };
    onToggleHost: () => void;
    mode: AppMode;
    onModeChange: (mode: AppMode) => void;
    onExport: () => void;
    exporting: boolean;
    /** The host's runs, when it manages any. */
    runs: RunsState;
    /** Open the new-run form. */
    onNewRun: () => void;
}) {
    const os = platform();
    // Recomputed each render so the estimate tracks the poll rather than freezing at its first value.
    // status.startedAt is the CURRENT extension's start; progress.startedAt is the batch's. The
    // difference between them is what lets the estimate count down instead of drifting up.
    const eta = estimate(host.status?.progress, Date.now(), host.status?.startedAt);

    return (
        /*
         * Three bands: run controls left, the mode switch centred, export and settings right.
         * A grid with equal outer columns keeps the switch centred as the bands change width, since
         * a control that moves when a migration starts is a control you have to look for. Unlike
         * absolute centring it gives the bands room first, so on a narrow window the switch shifts
         * rather than sitting under the export button.
         */
        <header
            className={cn(
                "app-drag grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-card px-3 lg:gap-4 lg:px-5",
                os === "darwin" && "pl-[84px] lg:pl-[84px]",
                (os === "win32" || os === "linux") && "pr-[148px] lg:pr-[148px]",
            )}
        >
            <div className="flex min-w-0 items-center gap-2 lg:gap-4">
                <div className="flex items-center gap-2">
                    <Terminal className="size-4 text-primary" />
                    <span className="hidden font-semibold tracking-tight lg:inline">extlens</span>
                </div>

                <Separator orientation="vertical" className="h-5" />

                {/*
                  * One group: the job control and the way to the runs list. Both act on the run, and
                  * Runs was previously reachable only through the model chip, which did not look
                  * like a button.
                  */}
                <div className="flex items-center">
                    {host.supported ? (
                        <Button
                            size="sm"
                            variant={host.running ? "destructive" : "default"}
                            onClick={onToggleHost}
                            className="rounded-r-none"
                        >
                            {host.running ? <Square className="size-4" /> : <Play className="size-4" />}
                            {host.running ? "Stop" : "Migrate all"}
                        </Button>
                    ) : (
                        <Button size="sm" onClick={onNewRun} disabled={runs.busy} className="rounded-r-none">
                            <Plus className="size-4" />
                            New run
                        </Button>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                variant={mode === "runs" ? "secondary" : "outline"}
                                onClick={() => onModeChange("runs")}
                                className="rounded-l-none border-l-0"
                            >
                                <Layers className="size-4" />
                                <span className="hidden md:inline">Runs</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Past runs, and starting a new one</TooltipContent>
                    </Tooltip>
                </div>

                {host.running && eta ? (
                    <div className="hidden min-w-44 flex-col gap-1 md:flex">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="tabular-nums text-foreground">
                                {host.status?.progress?.done ?? 0} / {host.status?.progress?.total ?? 0}
                            </span>
                            <span className="text-muted-foreground">
                                {eta.remaining ? `~${eta.remaining} left` : "estimating…"}
                            </span>
                        </div>
                        <Progress value={eta.fraction * 100} className="[&_[data-slot=progress-indicator]]:bg-peach" />
                    </div>
                ) : null}
            </div>

            <div className="flex items-center gap-1 rounded-md bg-secondary/60 p-0.5">
                <Button
                    size="sm"
                    variant={mode === "browse" ? "secondary" : "ghost"}
                    className={mode === "browse" ? "bg-background shadow-sm" : ""}
                    onClick={() => onModeChange("browse")}
                >
                    <Table2 className="size-4" />
                    <span className="hidden sm:inline">Browse</span>
                </Button>
                <Button
                    size="sm"
                    variant={mode === "review" ? "secondary" : "ghost"}
                    className={mode === "review" ? "bg-background shadow-sm" : ""}
                    onClick={() => onModeChange("review")}
                >
                    <ClipboardCheck className="size-4" />
                    <span className="hidden sm:inline">Review</span>
                </Button>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-3">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
                            <Download className="size-4" />
                            <span className="hidden md:inline">Export</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download every saved report as CSV and JSON</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon-sm"
                            variant={mode === "settings" ? "secondary" : "ghost"}
                            aria-label="Settings"
                            aria-pressed={mode === "settings"}
                            onClick={() => onModeChange("settings")}
                        >
                            <Settings className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Settings</TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}
