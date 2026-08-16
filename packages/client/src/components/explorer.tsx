import React from "react";
import { Box, Text } from "ink";
import type { ExtensionLight, ListStats } from "@extlens/protocol";
import type { ExplorerState } from "../types.js";
import { Cursor, EmptyLine, ErrorLine, Loading } from "./ui.js";

function LightRow({ light, selected }: { light: ExtensionLight; selected: boolean }) {
  return (
    <Text>
      <Cursor selected={selected} />
      <Text color={selected ? "cyan" : undefined} bold={selected}>
        {String(light.score).padStart(4)}
      </Text>
      <Text color={selected ? "cyan" : undefined} bold={selected}>
        {" "}
        {light.name}
      </Text>
      <Text color={selected ? "cyan" : undefined}>
        {" "}
        v{light.version ?? "?"} · mv{light.manifestVersion}
      </Text>
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
            <LightRow key={light.id} light={light} selected={i === selectedIndex} />
          ))
        )}
      </Box>
    </Box>
  );
}
