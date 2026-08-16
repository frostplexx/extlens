import React from "react";
import { Box, Text, useStdout } from "ink";
import type { HostStatus } from "@extlens/protocol";

const RULE = "─";

/** A full-width dim horizontal rule. */
export function Rule({
  marginTop = 0,
  marginBottom = 0,
}: {
  marginTop?: number;
  marginBottom?: number;
}) {
  const { stdout } = useStdout();
  const width = stdout.columns ?? 80;
  return (
    <Box marginTop={marginTop} marginBottom={marginBottom}>
      <Text dimColor>{RULE.repeat(Math.max(10, width))}</Text>
    </Box>
  );
}

/** A section heading with an underline rule. */
export function Section({
  title,
  hint,
  marginTop = 1,
}: {
  title: string;
  hint?: string;
  marginTop?: number;
}) {
  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Box>
        <Text bold color="cyan">
          {title}
        </Text>
        {hint ? <Text dimColor>  {hint}</Text> : null}
      </Box>
      <Rule />
    </Box>
  );
}

/** Rows available for the explorer list, given the terminal height. */
export function listPageSize(rows?: number): number {
  return Math.max(5, Math.min(40, (rows ?? 24) - 7));
}

/** App header: brand + title on the left, contextual controls on the right. */
export function TopBar({
  title,
  right = null,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text color="green" bold>
            extlens
          </Text>
          <Text dimColor> — {title}</Text>
        </Text>
        {right ? <Text dimColor>{right}</Text> : null}
      </Box>
      <Rule marginTop={1} />
    </Box>
  );
}

/** Row marker: ▸ for the selected row, blank space otherwise. */
export function Cursor({ selected }: { selected: boolean }) {
  return <Text color="cyan">{selected ? "▸ " : "  "}</Text>;
}

/** Distinct error line. */
export function ErrorLine({ message }: { message: string }) {
  return <Text color="red">✗ {message}</Text>;
}

/** Distinct empty-state line. */
export function EmptyLine({ label }: { label: string }) {
  return <Text dimColor>{label}</Text>;
}

/** Distinct loading line. */
export function Loading({ label = "loading…" }: { label?: string }) {
  return <Text dimColor>{label}</Text>;
}

/** Host lifecycle state for the top bar: running/stopping phases, terminal state. */
export function HostStatusView({
  status,
  error = null,
}: {
  status: HostStatus | null;
  error?: string | null;
}) {
  if (error) {
    return (
      <Text color="red">
        host error: {error}
      </Text>
    );
  }
  if (!status) return <Text dimColor>host …</Text>;
  const { state, phase, extensionId } = status;
  if (state === "running") {
    return (
      <Text>
        <Text color="yellow">running {extensionId}</Text>
        {phase ? <Text dimColor> ({phase})</Text> : null}
      </Text>
    );
  }
  if (state === "stopping") {
    return <Text color="yellow">stopping {extensionId}</Text>;
  }
  if (phase === "done") {
    return (
      <Text>
        <Text color="green">done</Text>
        <Text dimColor> {extensionId}</Text>
      </Text>
    );
  }
  if (phase === "failed") {
    return (
      <Text>
        <Text color="red">failed</Text>
        <Text dimColor> {extensionId}</Text>
      </Text>
    );
  }
  if (phase === "stopped") {
    return (
      <Text>
        <Text color="yellow">stopped</Text>
        <Text dimColor> {extensionId}</Text>
      </Text>
    );
  }
  return <Text dimColor>idle</Text>;
}
