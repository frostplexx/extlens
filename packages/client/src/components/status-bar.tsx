import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus, Tab } from "../types.js";
import type { TunnelStatus } from "../ssh.js";
import { Rule } from "./ui.js";

export function StatusBar({
  status,
  message,
  tab,
  sshLabel = null,
  tunnel = null,
  hints = "",
}: {
  status: ConnectionStatus;
  message: string | null;
  tab: Tab;
  /** Remote host in ssh mode, or null for a local host. */
  sshLabel?: string | null;
  /** Tunnel state in ssh mode, or null for a local host. */
  tunnel?: TunnelStatus | null;
  /** Contextual key hints for the active tab, or "" for none. */
  hints?: string;
}) {
  const color = status === "connected" ? "green" : status === "connecting" ? "yellow" : "red";
  const segments = [];
  segments.push(
    <Text key="status" color={color}>
      ● {status}
    </Text>,
  );
  if (message) {
    segments.push(
      <Text key="message" dimColor>
        {" "}
        — {message}
      </Text>,
    );
  }
  if (sshLabel) {
    segments.push(
      <Text key="ssh" dimColor>
        {"  ·  "}ssh {sshLabel}
      </Text>,
    );
  }
  if (tunnel && tunnel !== "up") {
    segments.push(
      <Text key="tunnel" dimColor>
        {"  ·  "}tunnel {tunnel}
      </Text>,
    );
  }
  segments.push(
    <Text key="tab" dimColor>
      {"  ·  "}[{tab}]
    </Text>,
  );
  return (
    <Box flexDirection="column">
      <Rule marginTop={1} />
      <Box justifyContent="space-between">
        <Text>{segments}</Text>
        {hints ? <Text dimColor>{hints}</Text> : null}
      </Box>
    </Box>
  );
}
