import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type {
  ExtensionLight,
  ExtensionProfile,
  FileRefs,
  HostLogResult,
  HostStatus,
  ListResult,
  LogLine,
  OverallWorking,
  Report,
  ReportDraft,
  SortOrder,
} from "@extlens/protocol";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtlensClient } from "./api.js";
import { createSshManager } from "./ssh.js";
import type { SshManager, SshSpec, TunnelStatus } from "./ssh.js";
import {
  BROWSER_DIR,
  installChrome,
  missingBrowserMessage,
} from "./browsers/install.js";
import { BrowserManager, resolveExecutable } from "./browsers/manager.js";
import { Analyzer } from "./components/analyzer.js";
import { Explorer } from "./components/explorer.js";
import { ReportForm, buildReportRows } from "./components/report-form.js";
import { StatusBar } from "./components/status-bar.js";
import { HelpView, LogView, TooSmall, TopBar, isCompact, listPageSize, MIN_ROWS } from "./components/ui.js";
import { c } from "./theme.js";
import type {
  AnalyzerState,
  ConnectionStatus,
  ExplorerState,
  ReportDraftForm,
  View,
} from "./types.js";

const SORTS: SortOrder[] = ["interestingness_desc", "interestingness_asc", "name"];

const IDLE_BROWSER = { phase: "idle" as const, message: null, extensionId: null };

function fileRefToPath(ref: string): string {
  let path = ref.startsWith("file://") ? fileURLToPath(ref) : ref;
  if (path.endsWith("manifest.json")) path = dirname(path);
  return path;
}

/** Conditional form rows: which manifest capabilities exist. */
function manifestFlags(profile: ExtensionProfile | null): {
  hasPopup: boolean;
  hasSettings: boolean;
  isNewTab: boolean;
} {
  const manifest = profile?.manifest;
  return {
    hasPopup: !!manifest?.action?.defaultPopup,
    hasSettings: !!manifest?.optionsPage,
    isNewTab: !!manifest?.chromeUrlOverrides?.newtab,
  };
}

/** ExtPorter dependency rule: a failing quick assessment downgrades overall. */
function downgradeOverall(
  f: ReportDraftForm,
  flags: { hasPopup: boolean; hasSettings: boolean; isNewTab: boolean },
): OverallWorking {
  if (!f.installs) return "no";
  if (f.needsLogin) return "could_not_test";
  if (flags.hasPopup && !f.isPopupWorking) return "no";
  if (flags.hasSettings && !f.isSettingsWorking) return "no";
  if (flags.isNewTab && !f.isNewTabWorking) return "no";
  return f.overallWorking;
}

export function App({
  wsUrl,
  sshSpec = null,
}: {
  wsUrl: string;
  /** ssh destination when the host is remote; null in local mode. */
  sshSpec?: SshSpec | null;
}) {
  const sshMode = sshSpec !== null;
  const { exit } = useApp();
  const { stdout } = useStdout();
  // One screen of extensions per page. The list never renders more rows
  // than fit the terminal.
  const pageSize = listPageSize(stdout.rows);
  const compact = isCompact(stdout.rows);
  // Below MIN_ROWS even a one-row list overflows, and a frame taller than the terminal
  // scrolls its own top away. Say so instead of drawing a broken screen.
  const tooSmall = (stdout.rows ?? 24) < MIN_ROWS;
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [view, setView] = useState<View>("explorer");
  const [helpOpen, setHelpOpen] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerState>({
    lights: [],
    stats: null,
    page: 1,
    totalPages: 1,
    search: "",
    searchFocused: false,
    sort: "interestingness_desc",
    selectedIndex: 0,
    loading: false,
    error: null,
  });
  const [analyzer, setAnalyzer] = useState<AnalyzerState>({
    id: null,
    profile: null,
    files: null,
    report: null,
    loading: false,
    error: null,
    mv2: IDLE_BROWSER,
    mv3: IDLE_BROWSER,
    formOpen: false,
    prompts: [],
    scroll: 0,
  });
  const [form, setForm] = useState<ReportDraftForm | null>(null);
  // Conditional form rows and the ExtPorter dependency flags for the current profile.
  const formFlags = useMemo(() => manifestFlags(analyzer.profile), [analyzer.profile]);
  const formRows = useMemo(
    () => buildReportRows({ ...formFlags, listenerCount: analyzer.profile?.listeners.length ?? 0 }),
    [formFlags, analyzer.profile?.listeners.length],
  );
  const [tunnel, setTunnel] = useState<TunnelStatus>(sshMode ? "connecting" : "up");
  // Search as you type, but only query the host after the input settles.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(explorer.search), 300);
    return () => clearTimeout(timer);
  }, [explorer.search]);
  // Host lifecycle: current status, whether the host supports it, and any
  // start/stop error. `supported` goes false when host.status fails (e.g.
  // a host without a HostController) so the top bar hides the segment.
  const [host, setHost] = useState<{
    status: HostStatus | null;
    supported: boolean;
    error: string | null;
  }>({ status: null, supported: true, error: null });
  // Incremental host.log lines for the log dock. logOffset is the largest
  // seq already appended; prevRunStart identifies the job being logged.
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logOffset = useRef(0);
  const prevRunStart = useRef<string | null>(null);
  // Bumped to refetch the list when a host job finishes or stops: the
  // corpus may have changed (a new run row appears).
  const [refreshKey, setRefreshKey] = useState(0);
  const [passwordPrompt, setPasswordPrompt] = useState<{
    message: string;
    resolve: (secret: string) => void;
  } | null>(null);
  const [secret, setSecret] = useState("");
  const managerRef = useRef<SshManager | null>(null);
  const browsersRef = useRef(new BrowserManager());

  const handleClientStatus = useCallback(
    (next: ConnectionStatus, message?: string) => {
      setStatus(next);
      setStatusMessage(message ?? null);
      // A dropped connection may mean the tunnel died. Probe it now instead
      // of waiting for the next health check.
      if (sshMode && next === "disconnected") managerRef.current?.checkNow();
    },
    [sshMode],
  );

  const requestSecret = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      setPasswordPrompt({ message: `password for ${sshSpec?.destination}:`, resolve });
    });
  }, [sshSpec]);

  if (sshMode && !managerRef.current) {
    managerRef.current = createSshManager({
      spec: sshSpec as SshSpec,
      getSecret: requestSecret,
      onStatus: (next, message) => {
        setTunnel(next);
        if (next === "failed" && message) setStatusMessage(message);
      },
    });
  }

  // Local mode: the client exists from the start. SSH mode: it is created
  // once the tunnel is up, against the tunnel's fixed local port, so it
  // reconnects on its own across tunnel restarts.
  const [client, setClient] = useState<ExtlensClient | null>(() =>
    sshMode ? null : new ExtlensClient(wsUrl, handleClientStatus),
  );

  useEffect(() => {
    if (!client) return;
    client.start();
    return () => {
      client.stop();
      void browsersRef.current.closeAll();
    };
  }, [client]);

  useEffect(() => {
    if (!sshMode) return;
    managerRef.current?.start();
    const onExit = () => managerRef.current?.stop();
    process.on("exit", onExit);
    return () => {
      process.off("exit", onExit);
      managerRef.current?.stop();
    };
  }, [sshMode]);

  useEffect(() => {
    if (!sshMode || tunnel !== "up" || client) return;
    const port = managerRef.current?.localPort;
    if (port) setClient(new ExtlensClient(`ws://127.0.0.1:${port}`, handleClientStatus));
  }, [sshMode, tunnel, client, handleClientStatus]);

  // Host status: fetch once per connect. Failure means the host has no
  // HostController; stop showing the segment rather than erroring.
  useEffect(() => {
    if (!client || status !== "connected") return;
    let cancelled = false;
    void client
      .call<{ status: HostStatus }>("host.status")
      .then((r) => {
        if (!cancelled) setHost((h) => ({ ...h, status: r.status, supported: true }));
      })
      .catch(() => {
        if (!cancelled) setHost((h) => ({ ...h, status: null, supported: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const fetchLogs = useCallback(() => {
    if (!client) return;
    void client
      .call<HostLogResult>("host.log", { offset: logOffset.current })
      .then((r) => {
        const fresh = r.lines.filter((line) => line.seq > logOffset.current);
        if (fresh.length) setLogs((prev) => [...prev, ...fresh]);
        logOffset.current = Math.max(logOffset.current, r.nextOffset);
      })
      .catch(() => {
        /* host without host.log: the log dock falls back to status.message */
      });
  }, [client]);

  // Poll host.status while a job runs; refetch the list when it ends. Also
  // pull incremental host.log lines and append them to the log dock.
  useEffect(() => {
    if (!client || status !== "connected") return;
    const st = host.status;
    if (!st) return;
    const active = st.state === "running" || st.state === "stopping";
    // A new startedAt means a new job: reset the log dock and re-read from seq 1.
    if (active && st.startedAt !== prevRunStart.current) {
      setLogs([]);
      logOffset.current = 0;
    }
    prevRunStart.current = active ? st.startedAt : null;
    if (!active) return;
    const timer = setInterval(() => {
      void client
        .call<{ status: HostStatus }>("host.status")
        .then((r) => {
          setHost((h) => ({ ...h, status: r.status }));
          if (r.status.state === "idle") {
            setRefreshKey((k) => k + 1);
            fetchLogs();
          }
        })
        .catch((error: Error) => setHost((h) => ({ ...h, error: error.message })));
      fetchLogs();
    }, 1500);
    fetchLogs();
    return () => clearInterval(timer);
  }, [client, status, host.status?.state, fetchLogs]);

  const toggleHost = useCallback(() => {
    if (!client || status !== "connected") return;
    const st = host.status;
    if (st && (st.state === "running" || st.state === "stopping")) {
      void client
        .call<{ status: HostStatus }>("host.stop")
        .then((r) => {
          setHost((h) => ({ ...h, status: r.status, error: null }));
          setRefreshKey((k) => k + 1);
        })
        .catch((error: Error) => setHost((h) => ({ ...h, error: error.message })));
      return;
    }
    void client
      .call<{ status: HostStatus }>("host.startAll")
      .then((r) => {
        setHost((h) => ({ ...h, status: r.status, error: null }));
      })
      .catch((error: Error) => setHost((h) => ({ ...h, error: error.message })));
  }, [client, status, host.status]);

  // Explorer fetch: runs when the connection becomes available or when
  // page / search / sort / refreshKey change. Without the status dependency,
  // a connect that happens after the initial (failed) fetch would never retry.
  useEffect(() => {
    let cancelled = false;
    if (!client || status !== "connected") {
      setExplorer((e) => ({
        ...e,
        loading: status === "connecting",
        error: status === "connecting" ? null : "not connected",
      }));
      return () => {
        cancelled = true;
      };
    }
    setExplorer((e) => ({ ...e, loading: true, error: null }));
    void client
      .call<ListResult>("extensions.list", {
        page: explorer.page,
        pageSize,
        search: debouncedSearch || undefined,
        sort: explorer.sort,
      })
      .then((result) => {
        if (cancelled) return;
        // Defense in depth: never render more than the page size, even if
        // the host ignores pagination.
        const lights = result.extensions.slice(0, pageSize);
        setExplorer((e) => ({
          ...e,
          lights,
          stats: result.stats,
          totalPages: result.totalPages,
          loading: false,
          selectedIndex: Math.min(e.selectedIndex, Math.max(0, lights.length - 1)),
        }));
      })
      .catch((error: Error) => {
        if (!cancelled) setExplorer((e) => ({ ...e, loading: false, error: error.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, status, explorer.page, debouncedSearch, explorer.sort, pageSize, refreshKey]);

  const loadProfile = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        const [get, files, report] = await Promise.all([
          client.call<{ extension: ExtensionProfile }>("extensions.get", { id }),
          client.call<{ files: FileRefs }>("extensions.files", { id }),
          client.call<{ report: Report | null }>("reports.get", { extensionId: id }),
        ]);
        let fileRefs = files.files;
        if (sshMode) {
          const session = managerRef.current?.session;
          if (!session) throw new Error("tunnel not up");
          const resolved: FileRefs = {};
          for (const label of ["mv2", "mv3"] as const) {
            const ref = files.files[label];
            if (ref) resolved[label] = await session.downloadRef(label, id, ref);
          }
          fileRefs = resolved;
        }
        setAnalyzer((a) =>
          a.id === id
            ? { ...a, profile: get.extension, files: fileRefs, report: report.report, loading: false }
            : a,
        );
      } catch (error) {
        setAnalyzer((a) =>
          a.id === id ? { ...a, loading: false, error: (error as Error).message } : a,
        );
      }
    },
    [client, sshMode],
  );

  const showExtension = useCallback(
    (light: ExtensionLight) => {
      setView("analyzer");
      setExplorer((e) => ({ ...e, selectedIndex: Math.max(0, e.lights.indexOf(light)) }));
      setAnalyzer((a) => ({
        ...a,
        id: light.id,
        profile: null,
        files: null,
        report: null,
        loading: true,
        error: null,
        formOpen: false,
        mv2: IDLE_BROWSER,
        mv3: IDLE_BROWSER,
        prompts: [],
        scroll: 0,
      }));
      void loadProfile(light.id);
    },
    [loadProfile],
  );

  const openAnalyzer = useCallback(() => {
    const light = explorer.lights[explorer.selectedIndex];
    if (light) showExtension(light);
  }, [explorer.lights, explorer.selectedIndex, showExtension]);

  /**
   * Advance to the next extension, rolling onto the next page when the last
   * row of the current page is reached. Returns false when there is no next
   * extension (end of the last page).
   */
  const advanceAnalyzer = useCallback(
    async (currentId: string): Promise<boolean> => {
      const idx = explorer.lights.findIndex((l) => l.id === currentId);
      const next = explorer.lights[idx + 1];
      if (next) {
        void browsersRef.current.closeAll();
        showExtension(next);
        return true;
      }
      // End of the current page: jump to the first extension of the next page.
      if (explorer.page >= explorer.totalPages) return false;
      if (!client) return false;
      const nextPage = explorer.page + 1;
      try {
        const result = await client.call<ListResult>("extensions.list", {
          page: nextPage,
          pageSize,
          search: debouncedSearch || undefined,
          sort: explorer.sort,
        });
        const first = result.extensions[0];
        if (!first) return false;
        // Keep the explorer list in sync so returning there shows the right page.
        setExplorer((e) => ({
          ...e,
          page: nextPage,
          lights: result.extensions.slice(0, pageSize),
          stats: result.stats,
          totalPages: result.totalPages,
          selectedIndex: 0,
        }));
        await browsersRef.current.closeAll();
        showExtension(first);
        return true;
      } catch {
        return false;
      }
    },
    [explorer.lights, explorer.page, explorer.totalPages, explorer.sort, pageSize, debouncedSearch, client, showExtension],
  );

  const launchOne = useCallback(
    (label: "mv2" | "mv3", executable: string, extensionPath: string) => {
      void browsersRef.current.launch(
        { label, executable, extensionPath },
        IDLE_BROWSER,
        (next) => setAnalyzer((a) => ({ ...a, [label]: next })),
      );
    },
    [],
  );

  const runBrowsers = useCallback(async () => {
    const { id, files } = analyzer;
    if (!id || !files) return;
    const manager = browsersRef.current;
    await manager.closeAll();
    setAnalyzer((a) => ({ ...a, mv2: IDLE_BROWSER, mv3: IDLE_BROWSER, prompts: [] }));
    const missing: { label: "mv2" | "mv3"; message: string }[] = [];
    for (const label of ["mv2", "mv3"] as const) {
      const ref = files[label];
      if (!ref) continue;
      const executable = resolveExecutable(label);
      if (!executable) {
        missing.push({ label, message: missingBrowserMessage(label) });
        continue;
      }
      launchOne(label, executable, fileRefToPath(ref));
    }
    if (missing.length > 0) setAnalyzer((a) => ({ ...a, prompts: missing }));
  }, [analyzer, launchOne]);

  const downloadAndLaunch = useCallback(
    async (label: "mv2" | "mv3") => {
      const { id, files } = analyzer;
      if (!id || !files || !files[label]) return;
      setAnalyzer((a) => ({
        ...a,
        prompts: a.prompts.slice(1),
        [label]: { phase: "downloading", message: "downloading chrome for testing…", extensionId: null },
      }));
      try {
        const executable = await installChrome(label, (pct) =>
          setAnalyzer((a) => ({
            ...a,
            [label]: {
              phase: "downloading",
              message: `downloading chrome for testing… ${pct}%`,
              extensionId: null,
            },
          })),
        );
        launchOne(label, executable, fileRefToPath(files[label]));
      } catch (error) {
        setAnalyzer((a) => ({
          ...a,
          [label]: {
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
            extensionId: null,
          },
        }));
      }
    },
    [analyzer, launchOne],
  );

  const closeBrowsers = useCallback(async () => {
    await browsersRef.current.closeAll();
    setAnalyzer((a) => ({
      ...a,
      mv2: { phase: "closed", message: "closed", extensionId: null },
      mv3: { phase: "closed", message: "closed", extensionId: null },
    }));
  }, []);

  const openReportForm = useCallback(() => {
    const profile = analyzer.profile;
    const saved = analyzer.report;
    if (!profile) return;
    const statuses = profile.listeners.map((l) => {
      const found = saved?.listeners.find((r) => r.api === l.api && r.file === l.file);
      return found ? found.status : "untested";
    });
    setForm({
      installs: saved?.installs ?? true,
      worksInMv2: saved?.worksInMv2 ?? true,
      needsLogin: saved?.needsLogin ?? false,
      isPopupWorking: saved?.isPopupWorking ?? true,
      isSettingsWorking: saved?.isSettingsWorking ?? true,
      isNewTabWorking: saved?.isNewTabWorking ?? true,
      isInteresting: saved?.isInteresting ?? false,
      overallWorking: saved?.overallWorking ?? "yes",
      notes: saved?.notes ?? "",
      listenerStatus: statuses,
      cursor: 0,
      notesFocused: false,
      saving: false,
      savedId: null,
      error: null,
      verificationStart: Date.now(),
    });
    setAnalyzer((a) => ({ ...a, formOpen: true }));
  }, [analyzer.profile, analyzer.report]);

  const closeReportForm = useCallback(() => {
    setForm(null);
    setAnalyzer((a) => ({ ...a, formOpen: false }));
  }, []);

  const cycleForm = useCallback(
    (delta: 1 | -1) => {
      setForm((f) => {
        if (!f || f.notesFocused) return f;
        const row = formRows[f.cursor];
        if (!row) return f;
        if (row.kind === "listener") {
          const cycle = ["untested", "yes", "no"] as const;
          const statuses = [...f.listenerStatus];
          const idx = (cycle.indexOf(statuses[row.index] ?? "untested") + delta + 3) % 3;
          statuses[row.index] = cycle[idx];
          return { ...f, listenerStatus: statuses };
        }
        if (row.kind === "boolean") {
          const next = { ...f, [row.field]: !f[row.field] };
          return { ...next, overallWorking: downgradeOverall(next, formFlags) };
        }
        if (row.kind === "overall") {
          const cycle = ["yes", "no", "could_not_test"] as const;
          const idx = (cycle.indexOf(f.overallWorking) + delta + 3) % 3;
          return { ...f, overallWorking: cycle[idx] };
        }
        return f;
      });
    },
    [formRows, formFlags],
  );

  const moveForm = useCallback(
    (delta: 1 | -1) => {
      setForm((f) => {
        if (!f || f.notesFocused || formRows.length === 0) return f;
        return { ...f, cursor: (f.cursor + delta + formRows.length) % formRows.length };
      });
    },
    [formRows.length],
  );

  const toggleNotes = useCallback(() => {
    setForm((f) => (f ? { ...f, notesFocused: !f.notesFocused } : f));
  }, []);

  const commitNotes = useCallback((value: string) => {
    setForm((f) => (f ? { ...f, notes: value } : f));
  }, []);

  const submitForm = useCallback(() => {
    const f = form;
    const id = analyzer.id;
    const profile = analyzer.profile;
    if (!f || !id || !profile || f.saving || !client) return;
    setForm((x) => (x ? { ...x, saving: true, error: null } : x));
    const flags = manifestFlags(profile);
    const draft: ReportDraft = {
      extensionId: id,
      tested: true,
      verificationDurationSecs: (Date.now() - f.verificationStart) / 1000,
      installs: f.installs,
      worksInMv2: f.worksInMv2,
      needsLogin: f.needsLogin,
      isPopupWorking: flags.hasPopup ? f.isPopupWorking : null,
      isSettingsWorking: flags.hasSettings ? f.isSettingsWorking : null,
      isNewTabWorking: flags.isNewTab ? f.isNewTabWorking : null,
      isInteresting: f.isInteresting,
      overallWorking: f.overallWorking,
      notes: f.notes,
      listeners: profile.listeners.map((l, i) => ({
        api: l.api,
        file: l.file,
        line: l.line,
        status: f.listenerStatus[i] ?? "untested",
      })),
    };
    void client
      .call<{ id: string }>("reports.submit", { report: draft })
      .then(async (res) => {
        if (await advanceAnalyzer(id)) {
          setForm(null);
        } else {
          setForm((x) => (x ? { ...x, saving: false, savedId: res.id } : x));
          void loadProfile(id);
        }
      })
      .catch((error: Error) => {
        setForm((x) => (x ? { ...x, saving: false, error: error.message } : x));
      });
  }, [form, analyzer.id, analyzer.profile, client, loadProfile, advanceAnalyzer]);

  useInput((input, key) => {
    if (passwordPrompt) {
      if (key.escape) {
        passwordPrompt.resolve("");
        setPasswordPrompt(null);
        setSecret("");
      } else if (key.return) {
        passwordPrompt.resolve(secret);
        setPasswordPrompt(null);
        setSecret("");
      } else if (key.backspace || key.delete) {
        setSecret((s) => s.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSecret((s) => s + input);
      }
      return;
    }
    if (helpOpen) {
      if (key.escape || input === "?" || input === "q") setHelpOpen(false);
      if (key.ctrl && input === "c") exit();
      return;
    }
    if (view === "analyzer" && analyzer.formOpen) {
      // The report form owns keys, but '?' still opens help when not typing notes.
      if (input === "?" && !form?.notesFocused) setHelpOpen(true);
      return;
    }

    const prompt = analyzer.prompts[0];
    if (prompt) {
      if (input === "y" || input === "Y") {
        void downloadAndLaunch(prompt.label);
      } else if (input === "n" || input === "N" || key.escape) {
        setAnalyzer((a) => ({
          ...a,
          prompts: a.prompts.slice(1),
          [prompt.label]: { phase: "failed", message: prompt.message, extensionId: null },
        }));
      }
      return;
    }
    if (view === "explorer" && explorer.searchFocused) {
      if (key.escape || key.return) {
        setExplorer((e) => ({ ...e, searchFocused: false }));
      } else if (key.ctrl && input === "u") {
        setExplorer((e) => ({ ...e, search: "", page: 1, selectedIndex: 0 }));
      } else if (key.upArrow) {
        setExplorer((e) => ({ ...e, selectedIndex: Math.max(0, e.selectedIndex - 1) }));
      } else if (key.downArrow) {
        setExplorer((e) => ({
          ...e,
          selectedIndex: Math.min(e.lights.length - 1, e.selectedIndex + 1),
        }));
      } else if (key.backspace || key.delete) {
        setExplorer((e) => ({ ...e, search: e.search.slice(0, -1), page: 1, selectedIndex: 0 }));
      } else if (input && !key.ctrl && !key.meta) {
        setExplorer((e) => ({
          ...e,
          search: e.search + input,
          page: 1,
          selectedIndex: 0,
        }));
      }
      return;
    }

    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (input === "?") {
      setHelpOpen(true);
      return;
    }
    if (input === "l") {
      if (view === "log") {
        setView("explorer");
      } else {
        setView("log");
      }
      return;
    }

    if (view === "explorer") {
      if (input === "/") {
        setExplorer((e) => ({ ...e, searchFocused: true }));
        return;
      }
      if (input === "s") {
        setExplorer((e) => ({ ...e, sort: SORTS[(SORTS.indexOf(e.sort) + 1) % SORTS.length] }));
        return;
      }
      if (key.upArrow || input === "k") {
        setExplorer((e) => ({ ...e, selectedIndex: Math.max(0, e.selectedIndex - 1) }));
        return;
      }
      if (key.downArrow || input === "j") {
        setExplorer((e) => ({
          ...e,
          selectedIndex: Math.min(e.lights.length - 1, e.selectedIndex + 1),
        }));
        return;
      }
      if (input === "g") {
        setExplorer((e) => ({ ...e, selectedIndex: 0 }));
        return;
      }
      if (input === "G") {
        setExplorer((e) => ({ ...e, selectedIndex: Math.max(0, e.lights.length - 1) }));
        return;
      }
      if (key.return) {
        openAnalyzer();
        return;
      }
      if (input === "m") {
        toggleHost();
        return;
      }
      if (key.pageDown || input === "n") {
        setExplorer((e) => ({ ...e, page: Math.min(e.totalPages, e.page + 1) }));
        return;
      }
      if (key.pageUp || input === "p") {
        setExplorer((e) => ({ ...e, page: Math.max(1, e.page - 1) }));
        return;
      }
    } else if (view === "log") {
      if (key.escape || key.backspace) {
        setView("explorer");
      }
    } else {
      if (key.escape || key.backspace) {
        setView("explorer");
        return;
      }
      if (key.upArrow || input === "k") {
        setAnalyzer((a) => ({ ...a, scroll: Math.max(0, a.scroll - 1) }));
        return;
      }
      if (key.downArrow || input === "j") {
        setAnalyzer((a) => ({ ...a, scroll: a.scroll + 1 }));
        return;
      }
      if (input === "g") {
        setAnalyzer((a) => ({ ...a, scroll: 0 }));
        return;
      }
      if (input === "G") {
        setAnalyzer((a) => ({ ...a, scroll: 1000000 }));
        return;
      }
      if (input === "b") {
        void runBrowsers();
        return;
      }
      if (input === "x") {
        void closeBrowsers();
        return;
      }
      if (input === "r") {
        openReportForm();
      }
    }
  });

  const hints =
    view === "explorer"
      ? "↑/↓ j/k select · enter open · / search · ? help · q quit"
      : view === "log"
        ? "esc back · ? help · q quit"
        : analyzer.formOpen || analyzer.error || !analyzer.profile
          ? "? help · q quit"
          : "↑/↓ j/k scroll · b launch · x close · r report · esc back · ? help · q quit";

  if (tooSmall) {
    return <TooSmall rows={stdout.rows ?? 24} columns={stdout.columns ?? 80} />;
  }

  return (
    <Box flexDirection="column">
      {passwordPrompt ? (
        <Box flexDirection="column" borderStyle="round" borderColor={c.warning} paddingX={1} marginBottom={1}>
          <Text bold>password required</Text>
          <Text>{passwordPrompt.message}</Text>
          <Text color={c.accent}>{"•".repeat(secret.length) || " "}</Text>
          <Text color={c.muted}>enter to submit · esc to cancel</Text>
        </Box>
      ) : null}
      <TopBar status={status} />
      {helpOpen ? (
        <HelpView />
      ) : view === "explorer" ? (
        <Explorer state={explorer} host={host} pageSize={pageSize} compact={compact} />
      ) : view === "log" ? (
        <LogView
          status={host.status}
          lines={logs}
          error={host.error}
        />
      ) : analyzer.formOpen && form && !helpOpen ? (
        <ReportForm
          form={form}
          rows={formRows}
          auto={{
            name: analyzer.profile?.name ?? "",
            mv2Id: analyzer.profile?.mv2?.id ?? null,
            mv3Id: analyzer.profile?.manifest.id ?? null,
            elapsedSecs: (Date.now() - form.verificationStart) / 1000,
          }}
          onCycle={cycleForm}
          onMove={moveForm}
          onToggleNotes={toggleNotes}
          onNotesChange={commitNotes}
          onSubmit={submitForm}
          onCancel={closeReportForm}
          listenerApis={(analyzer.profile?.listeners ?? []).map((l) => ({ api: l.api, file: l.file }))}
        />
      ) : (
        <Analyzer state={analyzer} />
      )}
      <StatusBar
        message={statusMessage}
        sshLabel={sshMode ? (sshSpec?.destination ?? null) : null}
        tunnel={sshMode ? tunnel : null}
        hints={hints}
        compact={compact}
      />
    </Box>
  );
}
