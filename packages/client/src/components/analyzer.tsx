import React from "react";
import { Box, Text } from "ink";
import type { ExtensionProfile, ManifestSummary, ScoreBreakdown } from "@extlens/protocol";
import { BROWSER_DIR } from "../browsers/install.js";
import type { AnalyzerState, BrowserPhase, BrowserState } from "../types.js";
import { EmptyLine, ErrorLine, Loading, Section } from "./ui.js";

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

function Breakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <Box flexDirection="column">
      {BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0).map(([key, label]) => (
        <Text key={key}>
          <Text dimColor>{label.padEnd(22)}</Text>
          <Text bold color="cyan">
            {String(breakdown[key]).padStart(6)}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

function ManifestView({ manifest }: { manifest: ManifestSummary }) {
  const bg =
    manifest.background === null
      ? "none"
      : `${manifest.background.type}(${manifest.background.scripts.join(", ")})`;
  const rows: [string, string][] = [
    ["background", bg],
    ["permissions", manifest.permissions.join(", ")],
    ["host permissions", manifest.hostPermissions.join(", ")],
    ["content scripts", manifest.contentScripts.map((cs) => `${cs.matches.join("|")} → ${cs.js.join(", ")}`).join("; ")],
    ["popup", manifest.action?.defaultPopup ?? ""],
    ["options page", manifest.optionsPage ?? ""],
    ["new tab override", manifest.chromeUrlOverrides.newtab ?? ""],
  ].filter(([, value]) => value !== "");
  return (
    <Box flexDirection="column">
      {rows.map(([label, value]) => (
        <Text key={label}>
          <Text dimColor>{`${label}:`.padEnd(22)}</Text>
          {value}
        </Text>
      ))}
    </Box>
  );
}

const PHASE_COLORS: Record<BrowserPhase, string> = {
  idle: "gray",
  launching: "yellow",
  detecting: "yellow",
  downloading: "yellow",
  loaded: "green",
  failed: "red",
  closed: "gray",
};

function BrowserRow({ label, state }: { label: string; state: BrowserState }) {
  const color = PHASE_COLORS[state.phase] ?? "gray";
  return (
    <Text>
      <Text dimColor>{label.padEnd(4)}</Text>
      <Text color={color}>{state.phase}</Text>
      {state.message ? <Text dimColor> — {state.message}</Text> : null}
    </Text>
  );
}

export function Analyzer({ state }: { state: AnalyzerState }) {
  const { profile, report, loading, error, mv2, mv3, files, prompt } = state;

  if (loading) return <Loading label="loading profile…" />;
  if (error)
    return (
      <Box flexDirection="column">
        <ErrorLine message={error} />
        <Text dimColor>press esc to go back to the explorer</Text>
      </Box>
    );
  if (!profile) return <EmptyLine label="no extension selected" />;

  const working =
    report?.overallWorking === null ? "?" : report?.overallWorking ? "yes" : "no";
  const interesting =
    report?.isInteresting === null ? "?" : report?.isInteresting ? "yes" : "no";

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green" bold>
          {profile.name}
        </Text>
        <Text dimColor> v{profile.version ?? "?"} · mv{profile.manifestVersion}</Text>
        {profile.hasMv3 ? <Text color="green"> · has mv3 variant</Text> : null}
      </Text>
      <Text>
        <Text dimColor>score </Text>
        <Text bold color="cyan">
          {profile.score}
        </Text>
        <Text dimColor> · {formatBytes(profile.sizeBytes)}</Text>
      </Text>

      <Section title="breakdown" />
      <Breakdown breakdown={profile.breakdown} />

      <Section title="manifest" />
      <ManifestView manifest={profile.manifest} />

      <Section title="listeners" hint={`${profile.listeners.length} detected`} />
      {profile.listeners.length === 0 ? (
        <EmptyLine label="none detected" />
      ) : (
        <Box flexDirection="column">
          {profile.listeners.map((l, i) => (
            <Text key={`${l.api}:${l.file}:${l.line}`}>
              <Text dimColor>{String(i + 1).padStart(2)}) </Text>
              <Text bold={false}>{l.api}</Text>
              <Text dimColor> {l.file}:{l.line}</Text>
            </Text>
          ))}
        </Box>
      )}

      <Section title="browsers" hint="launch a browser to test the extension live" />
      <BrowserRow label="mv2" state={mv2} />
      <BrowserRow label="mv3" state={mv3} />
      {prompt ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1} flexDirection="column">
          <Text color="yellow">{prompt.message}</Text>
          <Text dimColor>
            download Chrome for Testing into {BROWSER_DIR}?  [y] yes  [n] no
          </Text>
        </Box>
      ) : null}
      {files ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>files:</Text>
          <Text dimColor>  mv2 {files.mv2}</Text>
          {files.mv3 ? <Text dimColor>  mv3 {files.mv3}</Text> : null}
        </Box>
      ) : null}

      <Section title="report" />
      {report ? (
        <Box flexDirection="column">
          <Text>
            <Text color="green">saved</Text>
            <Text dimColor>
              {" "}
              · tested {report.tested ? "yes" : "no"} · working {working} · interesting{" "}
              {interesting}
            </Text>
          </Text>
          {report.notes ? <Text dimColor>notes: {report.notes}</Text> : null}
        </Box>
      ) : (
        <EmptyLine label="no report yet — press r to record one" />
      )}
    </Box>
  );
}
