import React from "react";
import { Box, Text } from "ink";
import type { TunnelStatus } from "../ssh.js";
import { c } from "../theme.js";
import { Rule } from "./ui.js";

/**
 * Bottom bar: a dim rule, then context hints on the right and any status
 * message / ssh / tunnel detail on the left. Connection state now lives in
 * the menu bar.
 */
export function StatusBar({
  message,
  sshLabel = null,
  tunnel = null,
  hints = "",
}: {
  message: string | null;
  /** Remote host in ssh mode, or null for a local host. */
  sshLabel?: string | null;
  /** Tunnel state in ssh mode, or null for a local host. */
  tunnel?: TunnelStatus | null;
  /** Contextual key hints for the active tab, or "" for none. */
  hints?: string;
}) {
  const segments: React.ReactNode[] = [];
  if (message) {
    segments.push(
      <Text key="message" color={c.dim}>
        {message}
      </Text>,
    );
  }
  if (sshLabel) {
    segments.push(
      <Text key="ssh" color={c.muted}>
        {segments.length ? "  ·  " : ""}ssh {sshLabel}
      </Text>,
    );
  }
  if (tunnel && tunnel !== "up") {
    segments.push(
      <Text key="tunnel" color={c.warning}>
        {segments.length ? "  ·  " : ""}tunnel {tunnel}
      </Text>,
    );
  }
  return (
    <Box flexDirection="column">
      <Rule marginTop={1} />
      <Box justifyContent="space-between">
        <Text>{segments}</Text>
        {hints ? <Text color={c.muted}>{hints}</Text> : null}
      </Box>
    </Box>
  );
}
