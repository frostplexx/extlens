import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type {
  ExtensionProfile,
  FileRefs,
  ListResult,
  Report,
  ReportDraft,
  SortOrder,
} from "@extlens/protocol";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtlensClient } from "./api.js";
import {
  BROWSER_DIR,
  installChrome,
  missingBrowserMessage,
} from "./browsers/install.js";
import { BrowserManager, resolveExecutable } from "./browsers/manager.js";
import { Analyzer } from "./components/analyzer.js";
import { Explorer } from "./components/explorer.js";
import { ReportForm, BOOLEAN_KEYS, LISTENER_START } from "./components/report-form.js";
import { StatusBar } from "./components/status-bar.js";
import type {
  AnalyzerState,
  ConnectionStatus,
  ExplorerState,
  ReportDraftForm,
  Tab,
  TriState,
} from "./types.js";

const SORTS: SortOrder[] = ["interestingness_desc", "interestingness_asc", "name"];

const IDLE_BROWSER = { phase: "idle" as const, message: null, extensionId: null };

function fileRefToPath(ref: string): string {
  let path = ref.startsWith("file://") ? fileURLToPath(ref) : ref;
  if (path.endsWith("manifest.json")) path = dirname(path);
  return path;
}

export function App({ wsUrl }: { wsUrl: string }) {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("explorer");
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
    prompt: null,
  });
  const [form, setForm] = useState<ReportDraftForm | null>(null);

  const clientRef = useRef<ExtlensClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new ExtlensClient(wsUrl, (next, message) => {
      setStatus(next);
      setStatusMessage(message ?? null);
    });
  }
  const client = clientRef.current;
  const browsersRef = useRef(new BrowserManager());

  useEffect(() => {
    client.start();
    return () => {
      client.stop();
      void browsersRef.current.closeAll();
    };
  }, [client]);

  // Explorer fetch: runs when the connection becomes available or when
  // page / search / sort change. Without the status dependency, a connect
  // that happens after the initial (failed) fetch would never retry.
  useEffect(() => {
    let cancelled = false;
    if (status !== "connected") {
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
        pageSize: 50,
        search: explorer.search || undefined,
        sort: explorer.sort,
      })
      .then((result) => {
        if (cancelled) return;
        setExplorer((e) => ({
          ...e,
          lights: result.extensions,
          stats: result.stats,
          totalPages: result.totalPages,
          loading: false,
          selectedIndex: Math.min(e.selectedIndex, Math.max(0, result.extensions.length - 1)),
        }));
      })
      .catch((error: Error) => {
        if (!cancelled) setExplorer((e) => ({ ...e, loading: false, error: error.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, status, explorer.page, explorer.search, explorer.sort]);

  const loadProfile = useCallback(
    async (id: string) => {
      try {
        const [get, files, report] = await Promise.all([
          client.call<{ extension: ExtensionProfile }>("extensions.get", { id }),
          client.call<{ files: FileRefs }>("extensions.files", { id }),
          client.call<{ report: Report | null }>("reports.get", { extensionId: id }),
        ]);
        setAnalyzer((a) =>
          a.id === id
            ? { ...a, profile: get.extension, files: files.files, report: report.report, loading: false }
            : a,
        );
      } catch (error) {
        setAnalyzer((a) =>
          a.id === id ? { ...a, loading: false, error: (error as Error).message } : a,
        );
      }
    },
    [client],
  );

  const openAnalyzer = useCallback(() => {
    const light = explorer.lights[explorer.selectedIndex];
    if (!light) return;
    setTab("analyzer");
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
      prompt: null,
    }));
    void loadProfile(light.id);
  }, [explorer.lights, explorer.selectedIndex, loadProfile]);

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
    setAnalyzer((a) => ({ ...a, mv2: IDLE_BROWSER, mv3: IDLE_BROWSER, prompt: null }));
    for (const label of ["mv2", "mv3"] as const) {
      const ref = files[label];
      if (!ref) continue;
      const executable = resolveExecutable(label);
      if (!executable) {
        setAnalyzer((a) => ({
          ...a,
          prompt: { label, message: missingBrowserMessage(label) },
        }));
        continue;
      }
      launchOne(label, executable, fileRefToPath(ref));
    }
  }, [analyzer, launchOne]);

  const downloadAndLaunch = useCallback(
    async (label: "mv2" | "mv3") => {
      const { id, files } = analyzer;
      if (!id || !files || !files[label]) return;
      setAnalyzer((a) => ({
        ...a,
        prompt: null,
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
      tested: saved?.tested ?? null,
      overallWorking: saved?.overallWorking ?? null,
      hasErrors: saved?.hasErrors ?? null,
      seemsSlower: saved?.seemsSlower ?? null,
      needsLogin: saved?.needsLogin ?? null,
      isPopupBroken: saved?.isPopupBroken ?? null,
      isSettingsBroken: saved?.isSettingsBroken ?? null,
      isInteresting: saved?.isInteresting ?? null,
      notes: saved?.notes ?? "",
      listenerStatus: statuses,
      cursor: 0,
      notesFocused: false,
      saving: false,
      savedId: null,
      error: null,
    });
    setAnalyzer((a) => ({ ...a, formOpen: true }));
  }, [analyzer.profile, analyzer.report]);

  const closeReportForm = useCallback(() => {
    setForm(null);
    setAnalyzer((a) => ({ ...a, formOpen: false }));
  }, []);

  const cycleForm = useCallback((delta: 1 | -1) => {
    setForm((f) => {
      if (!f || f.notesFocused || f.cursor === BOOLEAN_KEYS.length) return f;
      if (f.cursor >= LISTENER_START) {
        const i = f.cursor - LISTENER_START;
        const cycle = ["untested", "yes", "no"] as const;
        const statuses = [...f.listenerStatus];
        const idx = (cycle.indexOf(statuses[i] ?? "untested") + delta + 3) % 3;
        statuses[i] = cycle[idx];
        return { ...f, listenerStatus: statuses };
      }
      const field = BOOLEAN_KEYS[f.cursor];
      const cycle = [null, true, false] as const;
      const idx = (cycle.indexOf(f[field]) + delta + 3) % 3;
      return { ...f, [field]: cycle[idx] };
    });
  }, []);

  const moveForm = useCallback((delta: 1 | -1) => {
    setForm((f) => {
      if (!f || f.notesFocused) return f;
      const rows = LISTENER_START + f.listenerStatus.length;
      return { ...f, cursor: (f.cursor + delta + rows) % rows };
    });
  }, []);

  const toggleNotes = useCallback(() => {
    setForm((f) => (f ? { ...f, notesFocused: !f.notesFocused } : f));
  }, []);

  const commitNotes = useCallback((value: string) => {
    setForm((f) => (f ? { ...f, notes: value } : f));
  }, []);

  const submitForm = useCallback(() => {
    const f = form;
    const id = analyzer.id;
    if (!f || !id || f.saving) return;
    setForm((x) => (x ? { ...x, saving: true, error: null } : x));
    const draft: ReportDraft = {
      extensionId: id,
      tested: f.tested === true,
      overallWorking: f.overallWorking,
      hasErrors: f.hasErrors,
      seemsSlower: f.seemsSlower,
      needsLogin: f.needsLogin,
      isPopupBroken: f.isPopupBroken,
      isSettingsBroken: f.isSettingsBroken,
      isInteresting: f.isInteresting,
      notes: f.notes,
      listeners: (analyzer.profile?.listeners ?? []).map((l, i) => ({
        api: l.api,
        file: l.file,
        line: l.line,
        status: f.listenerStatus[i] ?? "untested",
      })),
    };
    void client
      .call<{ id: string }>("reports.submit", { report: draft })
      .then((res) => {
        setForm((x) => (x ? { ...x, saving: false, savedId: res.id } : x));
        void loadProfile(id);
      })
      .catch((error: Error) => {
        setForm((x) => (x ? { ...x, saving: false, error: error.message } : x));
      });
  }, [form, analyzer.id, analyzer.profile, client, loadProfile]);

  useInput((input, key) => {
    if (tab === "analyzer" && analyzer.formOpen) return; // report form owns keys

    const prompt = analyzer.prompt;
    if (prompt) {
      if (input === "y" || input === "Y") {
        void downloadAndLaunch(prompt.label);
      } else if (input === "n" || input === "N" || key.escape) {
        setAnalyzer((a) => ({
          ...a,
          prompt: null,
          [prompt.label]: { phase: "failed", message: prompt.message, extensionId: null },
        }));
      }
      return;
    }
    if (tab === "explorer" && explorer.searchFocused) {
      if (key.escape || key.return || key.upArrow || key.downArrow) {
        setExplorer((e) => ({ ...e, searchFocused: false }));
      } else if (key.backspace || key.delete) {
        setExplorer((e) => ({ ...e, search: e.search.slice(0, -1) }));
      } else if (input && !key.ctrl && !key.meta) {
        setExplorer((e) => ({ ...e, search: e.search + input }));
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

    if (tab === "explorer") {
      if (input === "/") {
        setExplorer((e) => ({ ...e, searchFocused: true }));
        return;
      }
      if (input === "s") {
        setExplorer((e) => ({ ...e, sort: SORTS[(SORTS.indexOf(e.sort) + 1) % SORTS.length] }));
        return;
      }
      if (key.upArrow) {
        setExplorer((e) => ({ ...e, selectedIndex: Math.max(0, e.selectedIndex - 1) }));
        return;
      }
      if (key.downArrow) {
        setExplorer((e) => ({
          ...e,
          selectedIndex: Math.min(e.lights.length - 1, e.selectedIndex + 1),
        }));
        return;
      }
      if (key.return) {
        openAnalyzer();
        return;
      }
      if (input === "n") {
        setExplorer((e) => ({ ...e, page: Math.min(e.totalPages, e.page + 1) }));
        return;
      }
      if (input === "p") {
        setExplorer((e) => ({ ...e, page: Math.max(1, e.page - 1) }));
        return;
      }
    } else {
      if (key.escape || key.backspace) {
        setTab("explorer");
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

  return (
    <Box flexDirection="column">
      {tab === "explorer" ? <Explorer state={explorer} /> : <Analyzer state={analyzer} />}
      {tab === "analyzer" && analyzer.formOpen && form ? (
        <ReportForm
          form={form}
          onCycle={cycleForm}
          onMove={moveForm}
          onToggleNotes={toggleNotes}
          onNotesChange={commitNotes}
          onSubmit={submitForm}
          onCancel={closeReportForm}
          listenerApis={(analyzer.profile?.listeners ?? []).map((l) => ({ api: l.api, file: l.file }))}
        />
      ) : null}
      <StatusBar status={status} message={statusMessage} tab={tab} />
    </Box>
  );
}

// Re-exported for the entrypoint to keep TriState import used.
export type { TriState };
