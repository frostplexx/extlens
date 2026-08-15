import React from "react";
import { Box, Text } from "ink";
import type { ExtensionProfile, ManifestSummary, ScoreBreakdown } from "@extlens/protocol";
import type { AnalyzerState, BrowserState } from "../types.js";

const BAR = "█";
const EMPTY = "░";

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

function breakdownBar(count: number, max: number): string {
  const filled = Math.max(0, Math.round((count / Math.max(1, max)) * 10));
  return BAR.repeat(filled) + EMPTY.repeat(10 - filled);
}

function Breakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
  const max = Math.max(1, ...Object.values(breakdown));
  return (
    <Box flexDirection="column">
      {BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0).map(([key, label]) => (
        <Text key={key}>
          <Text dimColor>{label.padEnd(24)}</Text>
          <Text color="cyan">{breakdownBar(breakdown[key], max)}</Text>
          <Text> {String(breakdown[key]).padStart(3)}</Text>
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
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>background: </Text>
        {bg}
      </Text>
      {manifest.permissions.length > 0 ? (
        <Text>
          <Text dimColor>permissions: </Text>
          {manifest.permissions.join(", ")}
        </Text>
      ) : null}
      {manifest.hostPermissions.length > 0 ? (
        <Text>
          <Text dimColor>host permissions: </Text>
          {manifest.hostPermissions.join(", ")}
        </Text>
      ) : null}
      {manifest.contentScripts.length > 0 ? (
        <Text>
          <Text dimColor>content scripts: </Text>
          {manifest.contentScripts
            .map((cs) => `${cs.matches.join("|")} → ${cs.js.join(", ")}`)
            .join("; ")}
        </Text>
      ) : null}
      {manifest.action?.defaultPopup ? (
        <Text>
          <Text dimColor>popup: </Text>
          {manifest.action.defaultPopup}
        </Text>
      ) : null}
      {manifest.optionsPage ? (
        <Text>
          <Text dimColor>options page: </Text>
          {manifest.optionsPage}
        </Text>
      ) : null}
      {manifest.chromeUrlOverrides.newtab ? (
        <Text>
          <Text dimColor>new tab override: </Text>
          {manifest.chromeUrlOverrides.newtab}
        </Text>
      ) : null}
    </Box>
  );
}

function BrowserRow({ label, state }: { label: string; state: BrowserState }) {
  const color =
    state.phase === "loaded" ? "green" : state.phase === "failed" ? "red" : state.phase === "idle" ? "gray" : "yellow";
  return (
    <Text>
      <Text dimColor>{label.padEnd(4)}</Text>
      <Text color={color}>{state.phase}</Text>
      {state.message ? <Text dimColor> — {state.message}</Text> : null}
    </Text>
  );
}

export function Analyzer({ state }: { state: AnalyzerState }) {
  const { profile, report, loading, error, mv2, mv3, files } = state;

  if (loading) return <Text dimColor>loading profile…</Text>;
  if (error) return <Text color="red">{error}</Text>;
  if (!profile) return <Text dimColor>no extension selected</Text>;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{profile.name}</Text>
        <Text dimColor> v{profile.version ?? "?"} · mv{profile.manifestVersion}</Text>
        {profile.hasMv3 ? <Text color="green"> · has mv3 variant</Text> : <Text dimColor> · mv2 only</Text>}
      </Text>
      <Text>
        <Text dimColor>score </Text>
        <Text bold color="cyan">{profile.score}</Text>
        <Text dimColor> · {profile.sizeBytes} bytes</Text>
        {profile.tags.length > 0 ? <Text dimColor>  {profile.tags.join(" ")}</Text> : null}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>breakdown</Text>
        <Breakdown breakdown={profile.breakdown} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>manifest</Text>
        <ManifestView manifest={profile.manifest} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>listeners ({profile.listeners.length})</Text>
        {profile.listeners.length === 0 ? (
          <Text dimColor>none detected</Text>
        ) : (
          profile.listeners.map((l, i) => (
            <Text key={`${l.api}:${l.file}:${l.line}`}>
              <Text dimColor>{String(i + 1).padStart(2)}) </Text>
              <Text>{l.api}</Text>
              <Text dimColor> {l.file}:{l.line}</Text>
            </Text>
          ))
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>browsers</Text>
        <BrowserRow label="mv2" state={mv2} />
        <BrowserRow label="mv3" state={mv3} />
        {files ? (
          <Text dimColor>
            mv2: {files.mv2}
            {files.mv3 ? `\nmv3: ${files.mv3}` : ""}
          </Text>
        ) : null}
        <Text dimColor>b launch · x close · r report</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>report</Text>
        {report ? (
          <Text>
            <Text color="green">saved</Text>
            <Text dimColor> · tested={report.tested ? "yes" : "no"} working={report.overallWorking === null ? "?" : report.overallWorking ? "yes" : "no"}</Text>
            <Text dimColor> · {report.notes ? `notes: ${report.notes}` : ""}</Text>
          </Text>
        ) : (
          <Text dimColor>no report yet</Text>
        )}
      </Box>
    </Box>
  );
}
