/**
 * The application bar: identity, host controls, and the two connection states.
 *
 * Two links can fail independently — page↔server and server↔host — and which one is broken is the
 * difference between "restart the server" and "start the host", so they are never collapsed into
 * a single indicator.
 */
import * as React from "react";
import type { HostStatus } from "@extlens/protocol";
import { ClipboardCheck, Cpu, Download, Play, Square, Table2, Terminal } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { estimate } from "@/lib/eta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BridgeStatus } from "../bridge";
import type { SessionState } from "../types";
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
    mode: "browse" | "review";
    onModeChange: (mode: "browse" | "review") => void;
    onExport: () => void;
    exporting: boolean;
}) {
    // Recomputed each render so the estimate tracks the poll rather than freezing at its first value.
    const eta = estimate(host.status?.progress, Date.now());

    const link =
        status !== "open"
            ? { dot: "bg-destructive", label: `bridge ${status}`, hint: "the local server is not reachable" }
            : session?.connection === "connected"
              ? { dot: "bg-green", label: "connected", hint: "connected to the extlens host" }
              : {
                    dot: "bg-peach",
                    label: `host ${session?.connection ?? "…"}`,
                    hint: session?.message ?? "the local server cannot reach the host",
                };

    return (
        /*
         * Three bands: identity and host controls left, the mode switch centred, status right.
         * The switch is centred absolutely rather than by flex order, so it stays put as the left
         * and right bands change width — a control that moves when a migration starts is a control
         * you have to look for.
         */
        <header className="relative flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 lg:gap-4 lg:px-5">
            <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" />
                <span className="hidden font-semibold tracking-tight lg:inline">extlens</span>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-secondary/60 p-0.5 [&>*]:pointer-events-auto">
                <Button
                    size="sm"
                    variant={mode === "browse" ? "secondary" : "ghost"}
                    className={mode === "browse" ? "bg-background shadow-sm" : ""}
                    onClick={() => onModeChange("browse")}
                >
                    <Table2 className="size-4" />
                    Browse
                </Button>
                <Button
                    size="sm"
                    variant={mode === "review" ? "secondary" : "ghost"}
                    className={mode === "review" ? "bg-background shadow-sm" : ""}
                    onClick={() => onModeChange("review")}
                >
                    <ClipboardCheck className="size-4" />
                    Review
                </Button>
            </div>

            <Separator orientation="vertical" className="h-6" />

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

            <div className="ml-auto flex items-center gap-3">
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
                            <Badge variant="outline" className="hidden max-w-56 truncate font-normal lg:inline-flex">
                                <Cpu className="size-3" />
                                {host.model}
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>Migrations on this host run with {host.model}</TooltipContent>
                    </Tooltip>
                ) : null}

                {session?.ssh ? (
                    <Badge variant="outline" className="hidden max-w-48 truncate lg:inline-flex">
                        ssh {session.ssh}
                    </Badge>
                ) : null}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className={cn("size-2 shrink-0 rounded-full", link.dot)} />
                            <span className="hidden md:inline">{link.label}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>{link.hint}</TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}
