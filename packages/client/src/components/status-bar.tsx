import React from "react";
import { Text } from "ink";
import type { ConnectionStatus, Tab } from "../types.js";

export function StatusBar({
  status,
  message,
  tab,
  sshLabel = null,
}: {
  status: ConnectionStatus;
  message: string | null;
  tab: Tab;
  /** Remote host in ssh mode, or null for a local host. */
  sshLabel?: string | null;
}) {
  const color = status === "connected" ? "green" : status === "connecting" ? "yellow" : "red";
  return (
    <Text>
      <Text color={color}>● {status}</Text>
      {message ? <Text dimColor> — {message}</Text> : null}
      {sshLabel ? <Text dimColor>  ssh: {sshLabel}</Text> : null}
      <Text dimColor>  [{tab}]  q quit</Text>
    </Text>
  );
}
