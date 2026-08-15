import React from "react";
import { Box, Text } from "ink";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import type { ExplorerState } from "../types.js";

const BAR = "█";
const EMPTY = "░";

function scoreBar(score: number, maxScore: number): string {
  const filled = Math.round((score / maxScore) * 10);
  return BAR.repeat(filled) + EMPTY.repeat(10 - filled);
}

function LightRow({
  light,
  selected,
  maxScore,
}: {
  light: ExtensionLight;
  selected: boolean;
  maxScore: number;
}) {
  return (
    <Text backgroundColor={selected ? "blue" : undefined}>
      <Text color="cyan">{scoreBar(light.score, maxScore)}</Text>
      <Text> {String(light.score).padStart(4)} </Text>
      <Text bold={selected}>{light.name}</Text>
      <Text dimColor> v{light.version ?? "?"} mv{light.manifestVersion}</Text>
      {light.hasMv3 ? <Text color="green"> mv3✓</Text> : null}
      {light.tags.length > 0 ? <Text dimColor>  {light.tags.join(" ")}</Text> : null}
    </Text>
  );
}

function StatsHeader({ stats }: { stats: ListStats }) {
  return (
    <Text>
      <Text bold>{stats.total}</Text>
      <Text dimColor> extensions · </Text>
      <Text bold>{stats.analyzed}</Text>
      <Text dimColor> analyzed · </Text>
      <Text bold>{stats.withMv3}</Text>
      <Text dimColor> with mv3 · avg score </Text>
      <Text bold>{stats.avgScore.toFixed(1)}</Text>
    </Text>
  );
}

export function Explorer({ state }: { state: ExplorerState }) {
  const {
    lights,
    stats,
    sort,
    search,
    searchFocused,
    page,
    totalPages,
    selectedIndex,
    loading,
    error,
  } = state;

  const maxScore = Math.max(1, ...lights.map((l) => l.score));
  const sortLabel =
    sort === "interestingness_desc" ? "score↓" : sort === "interestingness_asc" ? "score↑" : "name";

  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          <Text color="green">extlens</Text>
          <Text dimColor> — explorer</Text>
        </Text>
        <Text>  </Text>
        {searchFocused ? (
          <Text>search: <Text color="cyan">{search}</Text>▌</Text>
        ) : search ? (
          <Text dimColor>search: {search}</Text>
        ) : (
          <Text dimColor>press / to search</Text>
        )}
        <Text>  </Text>
        <Text dimColor>sort: {sortLabel} (s)</Text>
      </Box>

      {stats ? <StatsHeader stats={stats} /> : <Text dimColor>connecting…</Text>}

      <Box flexDirection="column" marginTop={1}>
        {error ? (
          <Text color="red">{error}</Text>
        ) : loading && lights.length === 0 ? (
          <Text dimColor>loading…</Text>
        ) : lights.length === 0 ? (
          <Text dimColor>no extensions match</Text>
        ) : (
          lights.map((light, i) => (
            <LightRow
              key={light.id}
              light={light}
              selected={i === selectedIndex}
              maxScore={maxScore}
            />
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          page {page}/{totalPages} (n next, p prev) · ↑/↓ select · enter open · q quit
        </Text>
      </Box>
    </Box>
  );
}
