import React from "react";
import { Box, Text, useStdout } from "ink";

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
