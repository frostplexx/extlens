import React from "react";
import { Text } from "ink";
import type { ConnectionStatus, Tab } from "../types.js";

export function StatusBar({
  status,
  message,
  tab,
}: {
  status: ConnectionStatus;
  message: string | null;
  tab: Tab;
}) {
  const color = status === "connected" ? "green" : status === "connecting" ? "yellow" : "red";
  return (
    <Text>
      <Text color={color}>● {status}</Text>
      {message ? <Text dimColor> — {message}</Text> : null}
      <Text dimColor>  [{tab}]  q quit</Text>
    </Text>
  );
}
