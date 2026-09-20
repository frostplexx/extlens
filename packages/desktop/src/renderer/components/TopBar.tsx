/**
 * The application bar: identity, host controls, and the two connection states. It is also the
 * window's title bar — the native one is hidden — so it is a drag region, and it leaves room for
 * the window controls the OS draws over it: traffic lights on the left on macOS, the overlay on
 * the right elsewhere.
 *
 * The host link is also the way to change it: the status pill goes to settings, because "not
 * connected" and "connect somewhere else" are the same moment.
 */
import * as React from "react";
import type { HostStatus } from "@extlens/protocol";
import { ClipboardCheck, Cpu, Download, FileCode2, Play, Plug, Settings, Square, Table2, Terminal } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { estimate } from "@/lib/eta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { platform, type BridgeStatus } from "../bridge";
import type { AppMode, SessionState } from "../types";
import { cn } from "@/lib/utils";

export function TopBar({
    status,
    session,
    host,
    onToggleHost,
    mode,
    onModeChange,
    onExport,
    exporting,
}: {
    status: BridgeStatus;
    session: SessionState | null;
    host: { status: HostStatus | null; supported: boolean; running: boolean; model?: string | null };
    onToggleHost: () => void;
    mode: AppMode;
    onModeChange: (mode: AppMode) => void;
    onExport: () => void;
    exporting: boolean;
}) {
    const os = platform();
    // Recomputed each render so the estimate tracks the poll rather than freezing at its first value.
    // status.startedAt is the CURRENT extension's start; progress.startedAt is the batch's. The
    // difference between them is what lets the estimate count down instead of drifting up.
    const eta = estimate(host.status?.progress, Date.now(), host.status?.startedAt);

    const target = session?.target ?? null;
    const where = target === null ? "no host" : target.kind === "ssh" ? `ssh ${target.destination}` : target.url;
    const link =
        status !== "open"
            ? { dot: "bg-destructive", label: `bridge ${status}`, hint: "the app's own process is not answering" }
            : session?.connection === "connected"
              ? { dot: "bg-green", label: where, hint: "connected to the extlens host — click to change in settings" }
              : target === null
                ? { dot: "bg-secondary-foreground/40", label: where, hint: "click to choose a host in settings" }
                : {
                      dot: "bg-peach",
                      label: `${where} · ${session?.tunnel && session.tunnel !== "up" ? `tunnel ${session.tunnel}` : (session?.connection ?? "…")}`,
                      hint: session?.message ?? "cannot reach the host — click to change it in settings",
                  };

    return (
        /*
         * Three bands: identity and host controls left, the mode switch centred, status right.
         * A grid with equal outer columns keeps the switch centred as the left and right bands
         * change width — a control that moves when a migration starts is a control you have to
         * look for — but, unlike absolute centring, gives the bands room first: on a narrow window
         * the switch shifts rather than sitting under the export button.
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

                {host.supported ? (
                    <div className="flex items-center gap-3">
                        <Button size="sm" variant={host.running ? "destructive" : "default"} onClick={onToggleHost}>
                            {host.running ? <Square className="size-4" /> : <Play className="size-4" />}
                            {host.running ? "Stop migration" : "Migrate all"}
                        </Button>
                        {/*
                          * Where the batch is, not which extension it happens to be on.
                          *
                          * The id is 32 random characters and the phase changes every few minutes;
                          * neither answers the question someone glancing at a day-long run is asking,
                          * which is how much is left. The log dock still has the detail.
                          */}
                        {host.running && eta ? (
                            <div className="hidden min-w-44 flex-col gap-1 md:flex">
                                <div className="flex items-baseline justify-between gap-2 text-xs">
                                    {/* Plain foreground: the count is a fact, not a warning. The bar
                                        below carries the "something is running" colour. */}
                                    <span className="tabular-nums text-foreground">
                                        {host.status?.progress?.done ?? 0} / {host.status?.progress?.total ?? 0}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {eta.remaining ? `~${eta.remaining} left` : "estimating…"}
                                    </span>
                                </div>
                                <Progress
                                    value={eta.fraction * 100}
                                    className="[&_[data-slot=progress-indicator]]:bg-peach"
                                />
                            </div>
                        ) : null}
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
                <Button
                    size="sm"
                    variant={mode === "code" ? "secondary" : "ghost"}
                    className={mode === "code" ? "bg-background shadow-sm" : ""}
                    onClick={() => onModeChange("code")}
                >
                    <FileCode2 className="size-4" />
                    <span className="hidden sm:inline">Code</span>
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

                {/* Which model produced this corpus. A results table that cannot name its model is
                    not a result, and nothing else on screen says which one ran. */}
                {host.model ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="outline" className="hidden min-w-0 max-w-56 shrink font-normal xl:inline-flex">
                                <Cpu className="size-3 shrink-0" />
                                <span className="truncate">{host.model}</span>
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>Migrations on this host run with {host.model}</TooltipContent>
                    </Tooltip>
                ) : null}

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
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onModeChange("settings")}
                            className="min-w-0 max-w-72 shrink text-muted-foreground"
                        >
                            <span className={cn("size-2 shrink-0 rounded-full", link.dot)} />
                            <span className="hidden truncate md:inline">{link.label}</span>
                            <Plug className="size-3.5 md:hidden" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{link.hint}</TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}
