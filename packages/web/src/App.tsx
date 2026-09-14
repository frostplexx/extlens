/**
 * Composition root: hooks own behaviour, this owns wiring — the same split as the terminal client.
 *
 * The frame is fixed to the viewport (bar, toolbar, split body, log dock) so the page itself never
 * scrolls; the table and the detail pane scroll independently. Comparing a row against its profile
 * is the core motion of a review pass, and having either move under the reader breaks it.
 */
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportDraft } from "@extlens/protocol";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useBridge } from "./hooks/useBridge";
import { useExtensions } from "./hooks/useExtensions";
import { useHostJob } from "./hooks/useHostJob";
import { useProfile } from "./hooks/useProfile";
import { DetailPane } from "./components/DetailPane";
import { ExtensionTable } from "./components/ExtensionTable";
import { LogDock } from "./components/LogDock";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { EmptyState } from "./components/shared";

export function App() {
    const bridge = useBridge();
    const connected = bridge.status === "open" && bridge.session?.connection === "connected";

    const list = useExtensions(bridge, connected);
    const profile = useProfile(bridge, list.selectedId, connected);
    const host = useHostJob(bridge, connected, list.refresh);

    const [logOpen, setLogOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    /**
     * Fire-and-forget bridge calls still have to report failure. Launching a browser can fail for
     * reasons the user can act on — the ssh tunnel being down, a missing binary — and a rejected
     * promise nobody caught leaves the UI looking like the click did nothing.
     */
    const run = useCallback(
        (method: string, params: Record<string, unknown> = {}) => {
            setActionError(null);
            bridge.call(method, params).catch((e: Error) => setActionError(e.message));
        },
        [bridge],
    );

    // A starting job opens the dock once. Having to go find the log to learn a batch began is a
    // small papercut that recurs every single run.
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
                    // Both need refreshing: the row gains its ✓, the pane gains the saved report.
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

    // The keyboard review loop, mirroring the terminal client. Suppressed while typing, since
    // j and k are also letters.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target?.getAttribute("role") === "combobox" ||
                target?.isContentEditable === true;
            if (e.key === "/" && !typing) {
                e.preventDefault();
                searchRef.current?.focus();
                return;
            }
            if (e.key === "Escape" && typing) {
                target?.blur();
                return;
            }
            if (typing || e.metaKey || e.ctrlKey) return;
            if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                list.moveSelection(1);
            } else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                list.moveSelection(-1);
            } else if (e.key === "l") {
                setLogOpen((v) => !v);
            } else if (e.key === "b") {
                run("local.launch", { files: profile.files, id: list.selectedId });
            } else if (e.key === "x") {
                run("local.close");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [run, list, profile.files]);

    const error = actionError ?? list.error;

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex h-full flex-col bg-background text-foreground">
                <TopBar
                    status={bridge.status}
                    session={bridge.session}
                    host={{ status: host.status, supported: host.supported, running: host.running }}
                    onToggleHost={host.toggle}
                />

                {error ? (
                    <div className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-sm text-destructive">
                        <span className="min-w-0 flex-1 break-words">{error}</span>
                        <Button size="icon" variant="ghost" className="size-6" onClick={() => setActionError(null)}>
                            <X className="size-3.5" />
                        </Button>
                    </div>
                ) : null}

                <div className="flex min-h-0 flex-1">
                    <main className="flex min-w-0 flex-1 flex-col">
                        <Toolbar
                            search={list.search}
                            onSearch={list.setSearch}
                            sort={list.sort}
                            onSort={list.setSort}
                            stats={list.stats}
                            searchRef={searchRef}
                        />

                        {list.rows.length === 0 && !list.loading ? (
                            <EmptyState
                                title={list.search ? "No extensions match that search" : "No extensions yet"}
                                hint={list.search ? "Try a shorter query." : "Point the server at a host with a corpus."}
                            />
                        ) : (
                            <ExtensionTable
                                rows={list.rows}
                                selectedId={list.selectedId}
                                sort={list.sort}
                                onSort={list.setSort}
                                onSelect={list.select}
                                loading={list.loading}
                            />
                        )}

                        <div className="flex h-12 shrink-0 items-center justify-between border-t px-5 text-sm text-muted-foreground">
                            <span>
                                {list.rows.length} shown · page {list.page} of {list.totalPages}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => list.setPage(Math.max(1, list.page - 1))}
                                    disabled={list.page <= 1}
                                >
                                    <ChevronLeft className="size-4" />
                                    Previous
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => list.setPage(Math.min(list.totalPages, list.page + 1))}
                                    disabled={list.page >= list.totalPages}
                                >
                                    Next
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        </div>
                    </main>

                    <aside className="flex w-[34rem] shrink-0 flex-col border-l bg-card/40">
                        <DetailPane
                            profile={profile.profile}
                            files={profile.files}
                            report={profile.report}
                            loading={profile.loading}
                            error={profile.error}
                            local={bridge.local}
                            onLaunch={() => run("local.launch", { files: profile.files, id: list.selectedId })}
                            onCloseBrowsers={() => run("local.close")}
                            onAnswerPrompt={(accept) => run("local.answerPrompt", { accept })}
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
        </TooltipProvider>
    );
}
