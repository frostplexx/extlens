import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import type { ExtensionLight, HostStatus, ListStats, SortOrder } from "@extlens/protocol";
import type { ExplorerState } from "../types.js";
import { c } from "../theme.js";
import {
  EmptyLine,
  ErrorLine,
  Highlight,
  HostStatusView,
  Loading,
  Panel,
  scoreTone,
  useColumns,
} from "./ui.js";

/** Fixed widths (display columns) for the list row fields. */
const SCORE_W = 6;
const NAME_W = 18;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const SORT_LABELS: Record<SortOrder, string> = {
  interestingness_desc: "score↓",
  interestingness_asc: "score↑",
  name: "name",
};

/** Truncate to at most `maxWidth` display columns, reserving one for "…". */
function truncateWidth(s: string, maxWidth: number): string {
  if (stringWidth(s) <= maxWidth) return s;
  let out = "";
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    const cw = stringWidth(segment);
    if (w + cw > maxWidth - 1) break;
    out += segment;
    w += cw;
  }
  return `${out}…`;
}

/** Pad to exactly `width` display columns so trailing markers line up. */
function padEndWidth(s: string, width: number): string {
  const w = stringWidth(s);
  return w >= width ? s : `${s}${" ".repeat(width - w)}`;
}

/**
 * Search affordance, matching the ExtPorter ratatui search bar: a bordered
 * box with the term, a block cursor while focused, and the current sort.
 */
function SearchBar({ search, focused, sort }: { search: string; focused: boolean; sort: string }) {
  const borderColor = focused ? c.searchActive : c.searchInactive;
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} width="100%">
      <Text>
        <Text color={c.searchLabel} bold={focused}>
          Search:{" "}
        </Text>
        <Text color={c.text}>{search}</Text>
        <Text color={c.cursor}>{focused ? "█" : " "}</Text>
        <Text color={c.searchLabel}> • Sort by: </Text>
        <Text color={c.accent}>{sort}</Text>
        {focused ? (
          <Text color={c.muted}>  esc close · ctrl+u clear</Text>
        ) : (
          <Text color={c.muted}>  {search ? "/ edit" : "/ to search"}</Text>
        )}
      </Text>
    </Box>
  );
}

function LightRow({
  light,
  selected,
  search,
}: {
  light: ExtensionLight;
  selected: boolean;
  search: string;
}) {
  const tone = scoreTone(light.score);
  return (
    <Text backgroundColor={selected ? c.selectedBg : undefined} wrap="truncate-end">
      <Text color={selected ? c.selected : c.muted}>{selected ? "▶ " : "  "}</Text>
      <Text color={tone} bold>
        {String(light.score).padStart(SCORE_W)}
      </Text>
      <Text color={selected ? c.selectedFg : undefined} bold={selected}>
        {" "}
        <Highlight
          text={padEndWidth(truncateWidth(light.name, NAME_W), NAME_W)}
          query={search}
          bold={selected}
        />
      </Text>
      <Text color={selected ? c.selectedFg : c.muted}>
        {" "}
        mv{light.manifestVersion}
      </Text>
      <Text color={light.hasReport ? c.tested : light.hasMv3 ? c.migrated : undefined}>
        {" "}
        {light.hasReport ? "✓" : light.hasMv3 ? "↑" : " "}
      </Text>
    </Text>
  );
}

function StatsLine({ stats }: { stats: ListStats }) {
  return (
    <Text>
      <Text color={c.accent} bold>
        Total:{" "}
      </Text>
      <Text>{stats.total} </Text>
      <Text color={c.accent} bold>
        • Analyzed:{" "}
      </Text>
      <Text>{stats.analyzed} </Text>
      <Text color={c.accent} bold>
        • MV3:{" "}
      </Text>
      <Text>{stats.withMv3} </Text>
      <Text color={c.accent} bold>
        • Avg Score:{" "}
      </Text>
      <Text>{stats.avgScore.toFixed(1)}</Text>
    </Text>
  );
}

/** Key/value rows for the details panel, like the reference "Details" block. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text wrap="truncate-end">
      <Text color={c.label} bold>
        {label}:{" "}
      </Text>
      {children}
    </Text>
  );
}

function Details({ light, maxRows }: { light: ExtensionLight; maxRows?: number }) {
  const rows: [string, React.ReactNode][] = [
    ["Name", <Text bold>{light.name}</Text>],
    ["ID", <Text>{light.id}</Text>],
    ["Version", <Text>{light.version ?? "N/A"}</Text>],
    ["Manifest", <Text>mv{light.manifestVersion}</Text>],
    [
      "Score",
      <Text bold color={scoreTone(light.score)}>
        {light.score}
      </Text>,
    ],
    [
      "Tags",
      light.tags.length > 0 ? (
        <Text>{light.tags.join(", ")}</Text>
      ) : (
        <Text color={c.muted}>none</Text>
      ),
    ],
    ["Migrated", light.hasMv3 ? <Text color={c.migrated}>yes</Text> : <Text color={c.muted}>no</Text>],
    ["Tested", light.hasReport ? <Text color={c.tested}>yes</Text> : <Text color={c.muted}>no</Text>],
  ];
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Box flexDirection="column">
      {shown.map(([label, node]) => (
        <DetailRow key={label} label={label}>
          {node}
        </DetailRow>
      ))}
    </Box>
  );
}

export function Explorer({
  state,
  host = { status: null, error: null, supported: false },
  pageSize,
}: {
  state: ExplorerState;
  /** Host lifecycle segment on the stats row; optional in unit renders. */
  host?: { status: HostStatus | null; error: string | null; supported: boolean };
  /** Rows the list can show; used to pad the last page to a fixed height. */
  pageSize?: number;
}) {
  const { stats, search, searchFocused, selectedIndex, loading, error, page, totalPages } =
    state;
  // Defense in depth: never render more rows than fit, even if a host
  // ignores pagination or a stale state lingers between fetches.
  const lights = state.lights.slice(0, pageSize ?? state.lights.length);
  const selected = lights[selectedIndex] ?? null;
  const cols = useColumns();
  const gap = 1;
  const listWidth = Math.max(30, Math.floor((cols - gap) / 2));
  const detailsWidth = Math.max(30, cols - gap - listWidth);
  // The list panel keeps a fixed height: pad short pages (or empty/error
  // states) to the page size so the whole UI does not shrink and expose
  // stale lines from a previous frame.
  const renderedRows = error ? 1 : lights.length === 0 ? 1 : lights.length;
  const padCount = Math.max(0, (pageSize ?? lights.length) - renderedRows);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width="100%">
        {stats ? <StatsLine stats={stats} /> : <Loading label="connecting…" />}
        <Box>
          {host.supported ? <HostStatusView status={host.status} error={host.error} /> : null}
          <Text color={c.muted}>
            {host.supported ? "  ·  " : ""}page {page}/{totalPages}
          </Text>
        </Box>
      </Box>

      <Box marginY={1}>
        <SearchBar search={search} focused={searchFocused} sort={SORT_LABELS[state.sort]} />
      </Box>

      <Box flexDirection="row" columnGap={gap} width="100%">
        <Panel title={`Extensions (${stats?.total ?? lights.length})`} width={listWidth}>
          {error ? (
            <ErrorLine message={error} />
          ) : lights.length === 0 ? (
            loading ? (
              <Loading label="loading…" />
            ) : (
              <EmptyLine label={search ? "no extensions match the search" : "no extensions yet"} />
            )
          ) : (
            lights.map((light, i) => (
              <LightRow
                key={light.id}
                light={light}
                selected={i === selectedIndex}
                search={search}
              />
            ))
          )}
          {Array.from({ length: padCount }).map((_, i) => (
            <Text key={`pad-${i}`}> </Text>
          ))}
        </Panel>
        <Panel title="Details" width={detailsWidth}>
            {selected ? (
              <Details light={selected} maxRows={pageSize} />
            ) : (
              <Text color={c.muted}>select an extension to view details</Text>
            )}
          </Panel>
      </Box>
    </Box>
  );
}
