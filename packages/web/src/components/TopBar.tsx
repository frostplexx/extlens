/**
 * The application bar: identity, host controls, and the two connection states.
 *
 * Two links can fail independently — page↔server and server↔host — and which one is broken is the
 * difference between "restart the server" and "start the host", so they are never collapsed into
 * a single indicator.
 */
import * as React from "react";
import type { HostStatus } from "@extlens/protocol";
import { ClipboardCheck, Play, Square, Table2, Terminal } from "lucide-react";
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
}: {
    status: BridgeStatus;
    session: SessionState | null;
    host: { status: HostStatus | null; supported: boolean; running: boolean };
    onToggleHost: () => void;
    mode: "browse" | "review";
    onModeChange: (mode: "browse" | "review") => void;
}) {
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
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 lg:gap-4 lg:px-5">
            <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" />
                <span className="hidden font-semibold tracking-tight lg:inline">extlens</span>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Browse and review are different jobs over the same corpus, not two views of one
                screen, so the switch between them is the first control in the bar. */}
            <div className="flex shrink-0 items-center gap-1 rounded-md bg-secondary/60 p-0.5">
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
                    {host.running && host.status?.extensionId ? (
                        <span className="hidden truncate text-sm text-peach lg:inline">
                            {host.status.extensionId}
                            {host.status.phase ? (
                                <span className="text-muted-foreground"> · {host.status.phase}</span>
                            ) : null}
                        </span>
                    ) : null}
                </div>
            ) : null}

            <div className="ml-auto flex items-center gap-3">
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
