import React from "react";
import { Box, Text } from "ink";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import type { ExplorerState } from "../types.js";
import { Cursor, EmptyLine, ErrorLine, Loading } from "./ui.js";

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
    <Text>
      <Cursor selected={selected} />
      <Text color="cyan">{scoreBar(light.score, maxScore)}</Text>
      <Text> {String(light.score).padStart(4)} </Text>
      <Text bold={selected}>{light.name}</Text>
      <Text dimColor> v{light.version ?? "?"} · mv{light.manifestVersion}</Text>
      {light.hasMv3 ? <Text color="green"> · mv3✓</Text> : null}
    </Text>
  );
}

function StatsLine({ stats }: { stats: ListStats }) {
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
  const { lights, stats, search, selectedIndex, loading, error } = state;

  const maxScore = Math.max(1, ...lights.map((l) => l.score));

  return (
    <Box flexDirection="column">
      {stats ? <StatsLine stats={stats} /> : <Loading label="connecting…" />}

      <Box flexDirection="column" marginTop={1}>
        {error ? (
          <ErrorLine message={error} />
        ) : loading ? (
          <Loading label={lights.length === 0 ? "loading…" : "refreshing…"} />
        ) : lights.length === 0 ? (
          <EmptyLine label={search ? "no extensions match the search" : "no extensions yet"} />
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
    </Box>
  );
}
