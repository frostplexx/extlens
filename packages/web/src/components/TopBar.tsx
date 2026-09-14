/** Brand, search, sort, host controls and connection state — the app's one fixed row. */
import React from "react";
import type { HostStatus, ListStats, SortOrder } from "@extlens/protocol";
import type { BridgeStatus } from "../bridge.js";
import type { SessionState } from "../types.js";
import { SORTS } from "../hooks/useExtensions.js";
import { Button, Pill } from "./primitives.js";

export function TopBar({
    search,
    onSearch,
    sort,
    onSort,
    stats,
    status,
    session,
    host,
    onToggleHost,
    searchRef,
}: {
    search: string;
    onSearch: (value: string) => void;
    sort: SortOrder;
    onSort: (value: SortOrder) => void;
    stats: ListStats | null;
    status: BridgeStatus;
    session: SessionState | null;
    host: { status: HostStatus | null; supported: boolean; running: boolean };
    onToggleHost: () => void;
    searchRef: React.Ref<HTMLInputElement>;
}) {
    // Two connections can fail independently: the page↔server bridge, and the server↔host link.
    // Showing whichever is broken is the difference between "restart the server" and "start the
    // host", so they are never collapsed into one indicator.
    const connection =
        status !== "open"
            ? { tone: "bad" as const, label: `bridge ${status}` }
            : session?.connection === "connected"
              ? { tone: "good" as const, label: "connected" }
              : { tone: "warn" as const, label: `host ${session?.connection ?? "…"}` };

    return (
        <header className="flex items-center gap-4 border-b border-surface1 bg-mantle px-4 py-2">
            <span className="font-semibold text-green">extlens</span>

            <input
                ref={searchRef}
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="search by name…   (/)"
                className="w-72 rounded bg-surface0 px-2 py-1 text-text ring-1 ring-inset ring-surface1 placeholder:text-overlay0 focus:outline-none focus:ring-mauve"
            />

            <select
                value={sort}
                onChange={(e) => onSort(e.target.value as SortOrder)}
                className="rounded bg-surface0 px-2 py-1 text-text ring-1 ring-inset ring-surface1 focus:outline-none focus:ring-mauve"
            >
                {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                        {s.label}
                    </option>
                ))}
            </select>

            {stats ? (
                <div className="flex items-center gap-3 text-subtext0">
                    <span>{stats.total} total</span>
                    <span>{stats.withMv3} mv3</span>
                    <span>avg {stats.avgScore.toFixed(1)}</span>
                </div>
            ) : null}

            <div className="ml-auto flex items-center gap-3">
                {host.supported ? (
                    <>
                        {host.status?.extensionId && host.running ? (
                            <span className="text-peach">
                                {host.status.extensionId}
                                {host.status.phase ? ` (${host.status.phase})` : ""}
                            </span>
                        ) : null}
                        <Button tone={host.running ? "danger" : "primary"} onClick={onToggleHost}>
                            {host.running ? "stop" : "migrate all"}
                        </Button>
                    </>
                ) : null}
                <Pill tone={connection.tone}>{connection.label}</Pill>
                {session?.ssh ? <Pill tone="info">ssh {session.ssh}</Pill> : null}
            </div>
        </header>
    );
}
