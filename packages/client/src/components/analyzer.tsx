import React from "react";
import { Box, Text, useStdout } from "ink";
import type { ManifestSummary, ScoreBreakdown } from "@extlens/protocol";
import { BROWSER_DIR } from "../browsers/install.js";
import { contentRows } from "../layout.js";
import type { AnalyzerSubject } from "../state/useAnalyzer.js";
import type { Browsers } from "../state/useBrowsers.js";
import type { BrowserPhase, BrowserState } from "../types.js";
import { c } from "../theme.js";
import { EmptyLine, ErrorLine, Loading, Rule, ScrollView, bar, scoreBar, scoreTone } from "./ui.js";

const BREAKDOWN_LABELS: [keyof ScoreBreakdown, string][] = [
  ["webRequest", "webRequest"],
  ["htmlLines", "html lines"],
  ["storageLocal", "storage.local"],
  ["backgroundPage", "background page"],
  ["contentScripts", "content scripts"],
  ["dangerousPermissions", "dangerous permissions"],
  ["hostPermissions", "host permissions"],
  ["cryptoPatterns", "crypto patterns"],
  ["networkRequests", "network requests"],
  ["extensionSize", "size (100KB units)"],
  ["apiRenames", "api renames (host)"],
  ["manifestChanges", "manifest changes (host)"],
  ["fileModifications", "file modifications (host)"],
  ["webRequestToDnr", "webRequest→DNR (host)"],
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** One manifest as a list of label/value lines, empty values dropped. */
function manifestRows(manifest: ManifestSummary, showName = false): React.ReactNode[] {
  const bg =
    manifest.background === null
      ? "none"
      : `${manifest.background.type}(${manifest.background.scripts.join(", ")})`;
  const rows: [string, string][] = [
    ...(showName ? [["name", manifest.name] as [string, string]] : []),
    ...(manifest.id ? [["id", manifest.id] as [string, string]] : []),
    ...(manifest.description
      ? [["description", manifest.description] as [string, string]]
      : []),
    ["background", bg] as [string, string],
    ["permissions", manifest.permissions.join(", ")] as [string, string],
    ["host permissions", manifest.hostPermissions.join(", ")] as [string, string],
    [
      "content scripts",
      manifest.contentScripts
        .map((cs) => `${cs.matches.join("|")} → ${cs.js.join(", ")}`)
        .join("; "),
    ] as [string, string],
    ["popup", manifest.action?.defaultPopup ?? ""] as [string, string],
    ["options page", manifest.optionsPage ?? ""] as [string, string],
    ["new tab override", manifest.chromeUrlOverrides.newtab ?? ""] as [string, string],
  ].filter(([, value]) => value !== "");
  return rows.map(([label, value]) => (
    <Text key={label} wrap="truncate-end">
      <Text color={c.label}>{`${label}:`.padEnd(22)}</Text>
      {value}
    </Text>
  ));
}

const PHASE_COLORS: Record<BrowserPhase, string> = {
  idle: c.muted,
  launching: c.warning,
  detecting: c.warning,
  downloading: c.warning,
  loaded: c.success,
  failed: c.danger,
  closed: c.muted,
};

function BrowserRow({ label, state }: { label: string; state: BrowserState }) {
  const color = PHASE_COLORS[state.phase] ?? c.muted;
  return (
    <Text>
      <Text color={c.muted}>{label.padEnd(4)}</Text>
      <Text color={color}>{state.phase}</Text>
      {state.message ? <Text color={c.muted}> — {state.message}</Text> : null}
    </Text>
  );
}

/** Pushes a section title and its underline rule as two flat lines. */
function pushSection(lines: React.ReactNode[], key: string, title: string, hint?: string) {
  lines.push(
    <Text key={key}>
      <Text bold color={c.panelTitle}>
        {title}
      </Text>
      {hint ? <Text color={c.muted}>  {hint}</Text> : null}
    </Text>,
  );
  lines.push(<Rule key={`${key}-rule`} />);
}

/**
 * The profile screen: score breakdown, both manifests, listeners, browser state and the saved
 * report, rendered as flat one-line rows and windowed by `subject.scroll`.
 *
 * Browser state arrives as a separate prop rather than living on the subject: the browsers belong
 * to the session, not to the extension, and keeping them apart is what lets the analyzer re-render
 * on a download-progress tick without touching the loaded profile.
 */
export function Analyzer({ subject, browsers }: { subject: AnalyzerSubject; browsers: Browsers }) {
  const { profile, report, loading, error, files, scroll } = subject;
  const { mv2, mv3, prompts } = browsers;
  const prompt = prompts[0];
  const { stdout } = useStdout();

  if (loading) return <Loading label="loading profile…" />;
  if (error)
    return (
      <Box flexDirection="column">
        <ErrorLine message={error} />
        <Text color={c.muted}>press esc to go back to the explorer</Text>
      </Box>
    );
  if (!profile) return <EmptyLine label="no extension selected" />;

  const working = report?.overallWorking
    ? report.overallWorking === "could_not_test"
      ? "could not test"
      : report.overallWorking
    : "?";
  const interesting =
    report?.isInteresting === null ? "?" : report?.isInteresting ? "yes" : "no";

  // Build the whole document as flat one-line rows, then window by scroll.
  const lines: React.ReactNode[] = [];
  lines.push(
    <Text key="name" wrap="truncate-end">
      <Text color={c.panelTitle} bold>
        {profile.name}
      </Text>
      <Text color={c.muted}> v{profile.version ?? "?"} · mv{profile.manifestVersion}</Text>
      {profile.hasMv3 ? <Text color={c.success}> · has mv3 variant</Text> : null}
    </Text>,
  );
  lines.push(
    <Text key="score">
      <Text color={c.muted}>score </Text>
      <Text bold color={scoreTone(profile.score)}>
        {profile.score}
      </Text>
      <Text color={scoreTone(profile.score)}> {scoreBar(profile.score, 12)}</Text>
      <Text color={c.muted}> · {formatBytes(profile.sizeBytes)}</Text>
    </Text>,
  );
  if (profile.tags.length > 0) {
    lines.push(
      <Text key="tags">
        <Text color={c.muted}>tags</Text>
        {profile.tags.slice(0, 4).map((t) => (
          <Text key={t}> [{t}]</Text>
        ))}
        {profile.tags.length > 4 ? (
          <Text color={c.muted}> +{profile.tags.length - 4}</Text>
        ) : null}
      </Text>,
    );
  }

  pushSection(lines, "bd", "breakdown");
  const entries = BREAKDOWN_LABELS.filter(([key]) => profile.breakdown[key] > 0);
  const max = Math.max(...entries.map(([key]) => profile.breakdown[key]), 1);
  for (const [key, label] of entries) {
    lines.push(
      <Text key={`bd-${key}`}>
        <Text color={c.muted}>{label.padEnd(22)}</Text>
        <Text bold color={c.accent}>
          {String(profile.breakdown[key]).padStart(6)}
        </Text>
        <Text color={c.accent}>  {bar(profile.breakdown[key] / max, 12)}</Text>
      </Text>,
    );
  }

  pushSection(lines, "m3", profile.mv2 ? "manifest (mv3)" : "manifest");
  lines.push(...manifestRows(profile.manifest));
  if (profile.mv2) {
    pushSection(lines, "m2", "manifest (mv2)");
    lines.push(...manifestRows(profile.mv2, true));
  }

  pushSection(lines, "list", "listeners", `${profile.listeners.length} detected`);
  if (profile.listeners.length === 0) {
    lines.push(<EmptyLine key="list-none" label="none detected" />);
  } else {
    for (const [i, l] of profile.listeners.entries()) {
      lines.push(
        <Text key={`list-${l.api}:${l.file}:${l.line}`} wrap="truncate-end">
          <Text color={c.muted}>{String(i + 1).padStart(2)}) </Text>
          <Text>{l.api}</Text>
          <Text color={c.muted}> {l.file}:{l.line}</Text>
        </Text>,
      );
    }
  }

  pushSection(lines, "browsers", "browsers", "launch a browser to test the extension live");
  lines.push(<BrowserRow key="b-mv2" label="mv2" state={mv2} />);
  lines.push(<BrowserRow key="b-mv3" label="mv3" state={mv3} />);

  if (prompt) {
    lines.push(
      <Text key="b-prompt" color={c.warning} wrap="truncate-end">
        {prompt.message}
      </Text>,
    );
    lines.push(
      <Text key="b-prompt-q" color={c.muted} wrap="truncate-end">
        download Chrome for Testing into {BROWSER_DIR}?  [y] yes  [n] no
      </Text>,
    );
  }
  if (files) {
    lines.push(<Text key="files" color={c.muted}>files:</Text>);
    lines.push(<Text key="files-mv2" color={c.muted}>  mv2 {files.mv2}</Text>);
    if (files.mv3) lines.push(<Text key="files-mv3" color={c.muted}>  mv3 {files.mv3}</Text>);
  }

  pushSection(lines, "report", "report");
  if (report) {
    lines.push(
      <Text key="report-summary">
        <Text color={c.success}>saved</Text>
        <Text color={c.muted}>
          {" "}
          · tested {report.tested ? "yes" : "no"} · working {working} · interesting{" "}
          {interesting}
        </Text>
      </Text>,
    );
    if (report.notes) lines.push(<Text key="report-notes" color={c.muted}>notes: {report.notes}</Text>);
  } else {
    lines.push(<EmptyLine key="report-none" label="no report yet — press r to record one" />);
  }

  // The frame's vertical budget is layout.ts's business, not this component's.
  return <ScrollView lines={lines} height={contentRows(stdout.rows)} scroll={scroll} />;
}
