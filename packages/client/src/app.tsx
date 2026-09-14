/**
 * The client's composition root: wire the hooks together, pick a screen, dispatch keys.
 *
 * Everything with behaviour lives in state/ (one hook per concern) or keys/ (one table for
 * bindings). What remains here is the wiring — which is the part that genuinely is about the app
 * as a whole, and the only part that has to know all six concerns exist.
 */
import React, { useCallback, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import type { SshSpec } from "@extlens/session";
import { hintsFor, type Scope } from "./keys/keymap.js";
import { useKeymap, type Capture } from "./keys/useKeymap.js";
import { isCompact, listPageSize, contentRows, MIN_ROWS } from "./layout.js";
import { useAnalyzer } from "./state/useAnalyzer.js";
import { useBrowsers } from "./state/useBrowsers.js";
import { useConnection } from "./state/useConnection.js";
import { useExtensionList } from "./state/useExtensionList.js";
import { useHost } from "./state/useHost.js";
import { useReportForm } from "./state/useReportForm.js";
import { Analyzer } from "./components/analyzer.js";
import { Explorer } from "./components/explorer.js";
import { HelpView } from "./components/help.js";
import { LogView } from "./components/log.js";
import { ReportForm } from "./components/report-form.js";
import { StatusBar } from "./components/status-bar.js";
import { TooSmall, TopBar } from "./components/ui.js";
import { c } from "./theme.js";
import type { View } from "./types.js";

export function App({
    wsUrl,
    sshSpec = null,
}: {
    wsUrl: string;
    /** ssh destination when the host is remote; null in local mode. */
    sshSpec?: SshSpec | null;
}) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const rows = stdout.rows ?? 24;
    const pageSize = listPageSize(rows);
    const compact = isCompact(rows);

    const [view, setView] = useState<View>("explorer");
    const [helpOpen, setHelpOpen] = useState(false);
    const [helpScroll, setHelpScroll] = useState(0);
    const [secret, setSecret] = useState("");

    const conn = useConnection(wsUrl, sshSpec);
    const host = useHost(conn.client, conn.status);
    const list = useExtensionList(conn.client, conn.status, pageSize, host.refreshKey);
    const browsers = useBrowsers();

    // Opening an extension must close the previous one's browsers: two stale Chrome windows for
    // the extension you just left are worse than none, because they look like the current one.
    const onShow = useCallback(() => {
        setView("analyzer");
        void browsers.closeAll();
    }, [browsers]);
    const analyzer = useAnalyzer(conn.client, list, conn, onShow);

    const form = useReportForm(
        conn.client,
        analyzer.subject.profile,
        analyzer.subject.id,
        analyzer.advance,
        analyzer.reload,
    );

    /** The scope the keymap dispatches in. Modals are captures, not scopes. */
    const scope: Scope = view;

    // Modals, in precedence order. Each owns the keyboard until it is dismissed.
    const captures: Capture[] = [];

    if (conn.passwordPrompt) {
        captures.push((input, key) => {
            if (key.escape) conn.answerPrompt("");
            else if (key.return) {
                conn.answerPrompt(secret);
                setSecret("");
            } else if (key.backspace || key.delete) setSecret((s) => s.slice(0, -1));
            else if (input && !key.ctrl && !key.meta) setSecret((s) => s + input);
            return true;
        });
    }

    if (helpOpen) {
        captures.push((input, key) => {
            if (key.escape || input === "?" || input === "q") {
                setHelpOpen(false);
                setHelpScroll(0);
            } else if (key.upArrow || input === "k") setHelpScroll((s) => Math.max(0, s - 1));
            else if (key.downArrow || input === "j") setHelpScroll((s) => s + 1);
            else if (input === "g") setHelpScroll(0);
            else if (input === "G") setHelpScroll(Number.MAX_SAFE_INTEGER);
            return true;
        });
    }

    if (form.form) {
        // The form owns its own keys (ReportForm renders its own input handling), but '?' must
        // still reach help — except while typing notes, where '?' is a character.
        captures.push((input) => {
            if (input === "?" && !form.form?.notesFocused) setHelpOpen(true);
            return true;
        });
    }

    if (browsers.prompts.length > 0) {
        captures.push((input, key) => {
            const yes = input === "y" || input === "Y";
            const no = input === "n" || input === "N" || key.escape;
            if (yes || no) browsers.answerPrompt(yes, analyzer.subject.files);
            return true;
        });
    }

    if (view === "explorer" && list.state.searchFocused) {
        captures.push((input, key) => {
            if (key.escape || key.return) list.focusSearch(false);
            else if (key.ctrl && input === "u") list.clearSearch();
            else if (key.upArrow) list.move(-1);
            else if (key.downArrow) list.move(1);
            else if (key.backspace || key.delete) list.typeSearch("\b");
            else if (input && !key.ctrl && !key.meta) list.typeSearch(input);
            return true;
        });
    }

    useKeymap({
        scope,
        captures,
        onExit: exit,
        handlers: {
            quit: exit,
            help: () => setHelpOpen(true),
            log: () => setView((v) => (v === "log" ? "explorer" : "log")),
            back: () => setView("explorer"),
            up: () => (view === "explorer" ? list.move(-1) : analyzer.scrollBy(-1)),
            down: () => (view === "explorer" ? list.move(1) : analyzer.scrollBy(1)),
            top: () => (view === "explorer" ? list.jump("top") : analyzer.scrollTo("top")),
            bottom: () => (view === "explorer" ? list.jump("bottom") : analyzer.scrollTo("bottom")),
            open: () => list.selected && analyzer.show(list.selected),
            search: () => list.focusSearch(true),
            sort: list.cycleSort,
            nextPage: () => list.setPage(1),
            prevPage: () => list.setPage(-1),
            toggleHost: host.toggle,
            launchBrowsers: () => void browsers.launch(analyzer.subject.files),
            closeBrowsers: () => void browsers.closeAll(),
            report: () => form.open(analyzer.subject.profile, analyzer.subject.report),
        },
    });

    if (rows < MIN_ROWS) return <TooSmall rows={rows} columns={stdout.columns ?? 80} />;

    const scopeLabel = helpOpen ? "help" : form.form ? "report" : view;

    return (
        /*
         * The frame is pinned to the terminal: a fixed height so it never breathes with its
         * contents, and hidden overflow so a view that misbehaves is clipped at the bottom rather
         * than pushing the header off the top, which is unrecoverable.
         */
        <Box flexDirection="column" height={rows} overflow="hidden">
            {conn.passwordPrompt ? (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={c.warning}
                    paddingX={1}
                    marginBottom={1}
                >
                    <Text bold>password required</Text>
                    <Text>{conn.passwordPrompt.message}</Text>
                    <Text color={c.accent}>{"•".repeat(secret.length) || " "}</Text>
                    <Text color={c.muted}>enter to submit · esc to cancel</Text>
                </Box>
            ) : null}

            <TopBar status={conn.status} scope={scopeLabel} />

            {helpOpen ? (
                <HelpView height={contentRows(rows)} scroll={helpScroll} />
            ) : view === "explorer" ? (
                <Explorer state={list.state} host={host} pageSize={pageSize} compact={compact} />
            ) : view === "log" ? (
                <LogView status={host.status} lines={host.logs} error={host.error} height={contentRows(rows)} />
            ) : form.form ? (
                <ReportForm
                    form={form.form}
                    rows={form.rows}
                    auto={{
                        name: analyzer.subject.profile?.name ?? "",
                        mv2Id: analyzer.subject.profile?.mv2?.id ?? null,
                        mv3Id: analyzer.subject.profile?.manifest.id ?? null,
                        elapsedSecs: (Date.now() - form.form.verificationStart) / 1000,
                    }}
                    onCycle={form.cycle}
                    onMove={form.move}
                    onToggleNotes={form.toggleNotes}
                    onNotesChange={form.setNotes}
                    onSubmit={form.submit}
                    onCancel={form.close}
                    listenerApis={(analyzer.subject.profile?.listeners ?? []).map((l) => ({
                        api: l.api,
                        file: l.file,
                    }))}
                />
            ) : (
                <Analyzer subject={analyzer.subject} browsers={browsers} />
            )}

            {/* Push the footer to the bottom of the terminal instead of letting it float up
                under short content. */}
            <Box flexGrow={1} />

            <StatusBar
                message={conn.message}
                sshLabel={conn.sshMode ? (sshSpec?.destination ?? null) : null}
                tunnel={conn.tunnel}
                hints={helpOpen || form.form ? "esc close · q quit" : hintsFor(scope)}
                compact={compact}
            />
        </Box>
    );
}
