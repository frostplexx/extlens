/**
 * Composition root: hooks own behaviour, this owns wiring — the same split as the terminal client.
 *
 * The frame is fixed to the viewport (bar, toolbar, resizable body, log dock) so the page itself
 * never scrolls; the table and the detail pane scroll independently. Comparing a row against its
 * profile is the core motion of a review pass, and having either move under the reader breaks it.
 */
import * as React from "react";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ExplainResult, ReportDraft } from "@extlens/protocol";
import { ChevronLeft, ChevronRight, PackageOpen, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReportRow } from "@extlens/protocol";
import { download, exportFilename, reportsToCsv, reportsToJson } from "./lib/export-reports";
import { useBridge } from "./hooks/useBridge";
import { useExtensions } from "./hooks/useExtensions";
import { useHostJob } from "./hooks/useHostJob";
import { useProfile } from "./hooks/useProfile";
import { useReviewQueue } from "./hooks/useReviewQueue";
import { DetailPane } from "./components/DetailPane";
import { ExtensionTable } from "./components/ExtensionTable";
import { LogDock } from "./components/LogDock";
import { ReviewView } from "./components/ReviewView";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { Spinner } from "@/components/ui/spinner";
import type { AppMode } from "./types";
import type { CodeTarget } from "./components/CodeView";

// Lazy because Code mode carries Monaco, and browse/review should not pay for it.
const CodeView = lazy(() => import("./components/CodeView"));

export function App() {
    const bridge = useBridge();
    const connected = bridge.status === "open" && bridge.session?.connection === "connected";

    const [mode, setMode] = useState<AppMode>("browse");
    /**
     * Code mode is a detour, not a destination: it reads whatever browse or review had selected,
     * and Back returns to where it was entered from. So the mode that *drives* the subject stays
     * the one underneath, and the review queue is not torn down for reading code mid-pass.
     */
    const [codeFrom, setCodeFrom] = useState<"browse" | "review">("browse");
    const driving = mode === "code" ? codeFrom : mode;
    const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
    const [autoLaunch, setAutoLaunch] = useState(true);

    const list = useExtensions(bridge, connected);
    const queue = useReviewQueue(bridge, connected, list.sort, driving === "review");
    // One profile hook serves both modes; which extension it loads is whichever mode is driving.
    const subjectId = driving === "review" ? (queue.current?.id ?? null) : list.selectedId;
    const profile = useProfile(bridge, subjectId, connected);
    /**
     * File refs, but only once they belong to the extension on screen.
     *
     * Everything that launches a browser goes through this rather than `profile.files`: during the
     * gap between advancing the queue and the fetch resolving, those are still the previous
     * extension's paths, and a launch in that window opens the wrong extension.
     */
    const readyFiles = profile.loadedId === subjectId ? profile.files : null;
    const host = useHostJob(bridge, connected, list.refresh);

    const [logOpen, setLogOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    /**
     * Fire-and-forget bridge calls still have to report failure. Launching a browser can fail for
     * reasons the user can act on — the ssh tunnel being down, a missing binary — and a rejected
     * promise nobody caught leaves the UI looking like the click did nothing.
     */
    const run = useCallback(
        (method: string, params: Record<string, unknown> = {}) => {
            bridge.call(method, params).catch((e: Error) => toast.error(e.message));
        },
        [bridge],
    );

    /**
     * Open a page in the running test browsers.
     *
     * Same URL in both windows, which is what makes a content script's behaviour comparable
     * rather than remembered. Failure is worth a toast: "no browser running" is actionable.
     */
    const openUrl = useCallback(
        (url: string) => {
            bridge
                .call<{ opened: string[] }>("local.openUrl", { url })
                .then((r) => toast.success(`Opened in ${r.opened.join(" and ") || "no browser"}`))
                .catch((e: Error) => toast.error(e.message));
        },
        [bridge],
    );

    /** Show a file — a listener's, or the manifest by default — in Code mode, remembering the way back. */
    const openInCode = useCallback(
        (path: string | null, line: number | null) => {
            setMode((current) => {
                if (current !== "code") setCodeFrom(current);
                return "code";
            });
            if (path) setCodeTarget((t) => ({ path, line, nonce: (t?.nonce ?? 0) + 1 }));
        },
        [],
    );

    const changeMode = useCallback(
        (next: AppMode) => {
            if (next === "code") openInCode(null, null);
            else setMode(next);
        },
        [openInCode],
    );

    const exitCode = useCallback(() => setMode(codeFrom), [codeFrom]);

    // Relayed to the host untouched; it is the host that has the model, the report and the code.
    const explain = useCallback(
        (extensionId: string) => bridge.call<ExplainResult>("analysis.explain", { extensionId }),
        [bridge],
    );

    /**
     * Download every saved report.
     *
     * Both formats in one click: the CSV is the shape the corpus questions are asked in, and the
     * JSON keeps what the columns flatten away. Choosing between them at the moment of export is a
     * decision with no information behind it.
     */
    const exportReports = useCallback(() => {
        setExporting(true);
        bridge
            .call<{ reports: ReportRow[] }>("reports.list")
            .then((r) => {
                if (r.reports.length === 0) {
                    toast.info("No reports saved yet");
                    return;
                }
                download(exportFilename("csv"), reportsToCsv(r.reports), "text/csv");
                download(exportFilename("json"), reportsToJson(r.reports), "application/json");
                toast.success(`Exported ${r.reports.length} report${r.reports.length === 1 ? "" : "s"}`);
            })
            .catch((e: Error) => toast.error(e.message))
            .finally(() => setExporting(false));
    }, [bridge]);

    // A starting job opens the dock once. Having to go find the log to learn a batch began is a
    // small papercut that recurs every single run.
    const wasRunning = useRef(false);
    useEffect(() => {
        if (host.running && !wasRunning.current) setLogOpen(true);
        wasRunning.current = host.running;
    }, [host.running]);

    // List failures are transport-level and transient; a toast says so without the table having to
    // give up the rows it already has.
    useEffect(() => {
        if (list.error) toast.error(list.error);
    }, [list.error]);

    const submitReport = useCallback(
        (draft: ReportDraft) => {
            setSubmitting(true);
            setSubmitError(null);
            bridge
                .call<{ id: string }>("reports.submit", { report: draft })
                .then(() => {
                    setSubmitting(false);
                    toast.success("Report saved");
                    if (mode === "review") {
                        // Saving is what advances a review pass; making the reviewer then press
                        // "next" would be a second confirmation of a decision already made.
                        queue.completeCurrent();
                        list.refresh();
                    } else {
                        // Both need refreshing: the row gains its ✓, the pane gains the report.
                        list.refresh();
                        profile.reload();
                    }
                })
                .catch((e: Error) => {
                    setSubmitting(false);
                    setSubmitError(e.message);
                });
        },
        [bridge, mode, queue, list, profile],
    );

    // The keyboard review loop, mirroring the terminal client. Suppressed while typing, since j
    // and k are also letters.
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
            // Code mode is a detour: Escape goes back, and the list keys are left alone so the
            // subject cannot change underneath the editor.
            if (mode === "code") {
                if (e.key === "Escape") exitCode();
                return;
            }
            if (e.key === "c") {
                openInCode(null, null);
                return;
            }
            // Review mode moves through the queue; browse mode moves the table selection.
            if (mode === "review" && (e.key === "]" || e.key === "j")) {
                e.preventDefault();
                queue.next();
            } else if (mode === "review" && (e.key === "[" || e.key === "k")) {
                e.preventDefault();
                queue.previous();
            } else if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                list.moveSelection(1);
            } else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                list.moveSelection(-1);
            } else if (e.key === "l") {
                setLogOpen((v) => !v);
            } else if (e.key === "b") {
                run("local.launch", { files: readyFiles, id: subjectId });
            } else if (e.key === "x") {
                run("local.close");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [run, mode, queue, list, readyFiles, subjectId, openInCode, exitCode]);

    const empty = list.rows.length === 0 && !list.loading;

    /**
     * The working area: the review pass, or the browse table and its detail pane.
     *
     * Held as a value because the log dock changes the shape of the frame around it — open, it
     * shares a resizable split; closed, it is a fixed bar underneath — and the body itself does
     * not care which.
     */
    const body = mode === "code" ? (
                    <Suspense
                        fallback={
                            <div className="flex flex-1 items-center justify-center">
                                <Spinner className="size-5 text-muted-foreground" />
                            </div>
                        }
                    >
                        <CodeView
                            bridge={bridge}
                            profile={profile.loadedId === subjectId ? profile.profile : null}
                            files={readyFiles}
                            subjectId={subjectId}
                            target={codeTarget}
                            onExit={exitCode}
                        />
                    </Suspense>
                ) : mode === "review" ? (
                    <ReviewView
                        queue={queue}
                        profile={profile.profile}
                        files={readyFiles}
                        report={profile.report}
                        profileLoading={profile.loading}
                        profileError={profile.error}
                        local={bridge.local}
                        autoLaunch={autoLaunch}
                        onAutoLaunchChange={setAutoLaunch}
                        onLaunch={() => run("local.launch", { files: readyFiles, id: subjectId })}
                        onCloseBrowsers={() => run("local.close")}
                        onAnswerPrompt={(accept) => run("local.answerPrompt", { accept })}
                        onSubmitReport={submitReport}
                        submitting={submitting}
                        submitError={submitError}
                        onOpenUrl={openUrl}
                        onOpenSource={openInCode}
                        onExplain={explain}
                        onExit={() => setMode("browse")}
                    />
                ) : (
                <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
                    <ResizablePanel defaultSize={62} minSize={35}>
                        <div className="flex h-full min-w-0 flex-col">
                            <Toolbar
                                search={list.search}
                                onSearch={list.setSearch}
                                sort={list.sort}
                                onSort={list.setSort}
                                stats={list.stats}
                                searchRef={searchRef}
                            />

                            {empty ? (
                                <Empty className="flex-1">
                                    <EmptyHeader>
                                        <EmptyMedia variant="icon">
                                            {list.search ? <SearchX /> : <PackageOpen />}
                                        </EmptyMedia>
                                        <EmptyTitle>
                                            {list.search ? "No extensions match that search" : "No extensions yet"}
                                        </EmptyTitle>
                                        <EmptyDescription>
                                            {list.search ? (
                                                <>
                                                    Try a shorter query, or clear the box with <Kbd>Esc</Kbd>.
                                                </>
                                            ) : (
                                                "Point the server at a host that serves a corpus."
                                            )}
                                        </EmptyDescription>
                                    </EmptyHeader>
                                </Empty>
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
                        </div>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Resizable rather than fixed: how much room the profile deserves depends on
                        the extension — a 40-permission manifest and a two-line one are both normal. */}
                    <ResizablePanel defaultSize={38} minSize={25}>
                        <aside className="h-full bg-card/40">
                            <DetailPane
                                profile={profile.profile}
                                files={readyFiles}
                                report={profile.report}
                                loading={profile.loading}
                                error={profile.error}
                                local={bridge.local}
                                onLaunch={() => run("local.launch", { files: readyFiles, id: subjectId })}
                                onCloseBrowsers={() => run("local.close")}
                                onAnswerPrompt={(accept) => run("local.answerPrompt", { accept })}
                                onSubmitReport={submitReport}
                                submitting={submitting}
                                submitError={submitError}
                                onOpenUrl={openUrl}
                                onOpenSource={openInCode}
                                onExplain={explain}
                            />
                        </aside>
                    </ResizablePanel>
                </ResizablePanelGroup>
                );

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex h-full flex-col bg-background text-foreground">
                <TopBar
                    status={bridge.status}
                    session={bridge.session}
                    host={{
                        status: host.status,
                        supported: host.supported,
                        running: host.running,
                        model: host.status?.model ?? null,
                    }}
                    onToggleHost={host.toggle}
                    mode={mode}
                    onModeChange={changeMode}
                    onExport={exportReports}
                    exporting={exporting}
                />

                <div className="flex min-h-0 flex-1 flex-col">{body}</div>

                {/* Sizes itself; see LogDock for why that is not a panel group. */}
                <LogDock
                    open={logOpen}
                    onOpenChange={setLogOpen}
                    status={host.status}
                    lines={host.logs}
                    error={host.error}
                />

                <Toaster theme="dark" position="bottom-right" />
            </div>
        </TooltipProvider>
    );
}
