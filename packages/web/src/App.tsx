/**
 * Composition root: the same split as the terminal client — hooks own behaviour, this owns wiring.
 *
 * Layout is a fixed three-part frame (top bar, split body, log dock) sized to the viewport, so the
 * page never scrolls as a whole; the table and the detail pane scroll independently. That is the
 * browser equivalent of the terminal client's pinned frame, and it exists for the same reason:
 * content changing height under the reader is disorienting when you are comparing two things.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReportDraft } from "@extlens/protocol";
import { useBridge } from "./hooks/useBridge.js";
import { useExtensions } from "./hooks/useExtensions.js";
import { useHostJob } from "./hooks/useHostJob.js";
import { useProfile } from "./hooks/useProfile.js";
import { DetailPane } from "./components/DetailPane.js";
import { ExtensionTable } from "./components/ExtensionTable.js";
import { LogDock } from "./components/LogDock.js";
import { TopBar } from "./components/TopBar.js";
import { Button, ErrorNote } from "./components/primitives.js";

export function App() {
    const bridge = useBridge();
    const connected = bridge.status === "open" && bridge.session?.connection === "connected";

    const list = useExtensions(bridge, connected);
    const profile = useProfile(bridge, list.selectedId, connected);
    const host = useHostJob(bridge, connected, list.refresh);

    const [logOpen, setLogOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // A running job opens the dock once, unprompted: a batch migration is the one thing worth
    // watching, and having to go find the log to learn it started is a small papercut every time.
    const wasRunning = useRef(false);
    useEffect(() => {
        if (host.running && !wasRunning.current) setLogOpen(true);
        wasRunning.current = host.running;
    }, [host.running]);

    const submitReport = useCallback(
        (draft: ReportDraft) => {
            setSubmitting(true);
            setSubmitError(null);
            bridge
                .call<{ id: string }>("reports.submit", { report: draft })
                .then(() => {
                    setSubmitting(false);
                    // Refresh both: the row gains its ✓, and the pane gains the saved report.
                    list.refresh();
                    profile.reload();
                })
                .catch((e: Error) => {
                    setSubmitting(false);
                    setSubmitError(e.message);
                });
        },
        [bridge, list, profile],
    );

    // Keyboard review loop, mirroring the terminal client's. Ignored while typing, because j/k
    // are also letters.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement;
            if (e.key === "/" && !typing) {
                e.preventDefault();
                searchRef.current?.focus();
                return;
            }
            if (e.key === "Escape" && typing) {
                (target as HTMLElement).blur();
                return;
            }
            if (typing) return;
            if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                list.moveSelection(1);
            } else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                list.moveSelection(-1);
            } else if (e.key === "l") {
                setLogOpen((v) => !v);
            } else if (e.key === "b") {
                void bridge.call("local.launch", { files: profile.files, id: list.selectedId });
            } else if (e.key === "x") {
                void bridge.call("local.close");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [bridge, list, profile.files]);

    return (
        <div className="flex h-full flex-col">
            <TopBar
                search={list.search}
                onSearch={list.setSearch}
                sort={list.sort}
                onSort={list.setSort}
                stats={list.stats}
                status={bridge.status}
                session={bridge.session}
                host={{ status: host.status, supported: host.supported, running: host.running }}
                onToggleHost={host.toggle}
                searchRef={searchRef}
            />

            {list.error ? <ErrorNote message={list.error} /> : null}

            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col border-r border-surface1">
                    <ExtensionTable
                        rows={list.rows}
                        selectedId={list.selectedId}
                        sort={list.sort}
                        onSort={list.setSort}
                        onSelect={list.select}
                        loading={list.loading}
                    />
                    <div className="flex items-center justify-between border-t border-surface0 px-4 py-1.5 text-subtext0">
                        <span>
                            {list.rows.length} shown · page {list.page}/{list.totalPages}
                        </span>
                        <div className="flex gap-2">
                            <Button onClick={() => list.setPage(Math.max(1, list.page - 1))} disabled={list.page <= 1}>
                                prev
                            </Button>
                            <Button
                                onClick={() => list.setPage(Math.min(list.totalPages, list.page + 1))}
                                disabled={list.page >= list.totalPages}
                            >
                                next
                            </Button>
                        </div>
                    </div>
                </div>

                <aside className="flex w-[38rem] min-w-0 shrink-0 flex-col">
                    <DetailPane
                        profile={profile.profile}
                        files={profile.files}
                        report={profile.report}
                        loading={profile.loading}
                        error={profile.error}
                        local={bridge.local}
                        onLaunch={() => void bridge.call("local.launch", { files: profile.files, id: list.selectedId })}
                        onClose={() => void bridge.call("local.close")}
                        onAnswerPrompt={(accept) => void bridge.call("local.answerPrompt", { accept })}
                        onSubmitReport={submitReport}
                        submitting={submitting}
                        submitError={submitError}
                    />
                </aside>
            </div>

            <LogDock
                open={logOpen}
                onToggle={() => setLogOpen((v) => !v)}
                status={host.status}
                lines={host.logs}
                error={host.error}
            />
        </div>
    );
}
