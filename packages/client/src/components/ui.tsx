import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { c } from "../theme.js";

const RULE = "─";

/** Terminal width, with a sane fallback for headless renders. */
export function useColumns(): number {
  const { stdout } = useStdout();
  return stdout.columns ?? 80;
}

/** A full-width dim horizontal rule. */
export function Rule({
  marginTop = 0,
  marginBottom = 0,
}: {
  marginTop?: number;
  marginBottom?: number;
}) {
  const width = useColumns();
  return (
    <Box marginTop={marginTop} marginBottom={marginBottom}>
      <Text color={c.border}>{RULE.repeat(Math.max(10, width))}</Text>
    </Box>
  );
}

/** A bordered panel with an in-box title, mirroring a ratatui block. */
export function Panel({
  title,
  children,
  color = c.panelBorder,
  titleColor = c.panelTitle,
  width,
}: {
  title?: string;
  children: React.ReactNode;
  color?: string;
  titleColor?: string;
  /** Fixed outer width in columns; undefined for shrink-to-content. */
  width?: number;
}) {
  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      paddingX={1}
      width={width}
    >
      {title ? (
        <Text bold color={titleColor}>
          {title}
        </Text>
      ) : null}
      {children}
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
        <Text bold color={c.panelTitle}>
          {title}
        </Text>
        {hint ? <Text color={c.muted}>  {hint}</Text> : null}
      </Box>
      <Rule />
    </Box>
  );
}

/**
 * Rows of chrome around the explorer list.
 *   normal:  menu bar (3), stats (1), search bar + margins (5), panel title + borders (3),
 *            column header (1), status bar with margin (3)
 *   compact: the same without the blank margins around the search bar and status bar.
 */
const CHROME_ROWS = 16;
const CHROME_ROWS_COMPACT = 13;

/** Below this the frame cannot fit even one list row, so we show a notice instead. */
export const MIN_ROWS = CHROME_ROWS_COMPACT + 1;

/** True when the terminal is short enough that the blank spacer rows must go. */
export function isCompact(rows?: number): boolean {
  return (rows ?? 24) < CHROME_ROWS + 5;
}

/**
 * Rows available for the explorer list, given the terminal height.
 *
 * The floor is ONE row, not five: a five-row minimum meant the frame was always at least
 * 21 rows tall, so every terminal shorter than that rendered a UI taller than the screen and
 * the top scrolled away. Short terminals now drop spacer rows and shrink the list instead.
 */
export function listPageSize(rows?: number): number {
  const chrome = isCompact(rows) ? CHROME_ROWS_COMPACT : CHROME_ROWS;
  return Math.max(1, Math.min(40, (rows ?? 24) - chrome));
}

/** Shown instead of a broken frame when the terminal cannot fit the UI. */
export function TooSmall({ rows, columns }: { rows: number; columns: number }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={c.warning} bold>
        terminal too small
      </Text>
      <Text color={c.muted}>
        {columns}×{rows} — extlens needs at least {MIN_ROWS} rows. Resize, or press q to quit.
      </Text>
    </Box>
  );
}

/**
 * App menu bar: brand on the left, connection state on the right.
 * There is no tab bar; screens are reached with enter/esc and 'l'.
 */
export function TopBar({ status }: { status: "connecting" | "connected" | "disconnected" }) {
  const statusColor =
    status === "connected" ? c.connected : status === "connecting" ? c.connecting : c.disconnected;
  const statusDot = status === "connecting" ? "◐" : "●";
  return (
    <Box
      borderStyle="round"
      borderColor={c.menuBorder}
      paddingX={1}
      justifyContent="space-between"
      alignItems="center"
    >
      <Text>
        <Text color={c.brand} bold>
          extlens
        </Text>
      </Text>
      <Text>
        <Text color={statusColor}>{statusDot}</Text>
        <Text color={c.muted}> {status}</Text>
      </Text>
    </Box>
  );
}

/** Row marker: ▶ for the selected row, blank space otherwise. */
export function Cursor({ selected }: { selected: boolean }) {
  return <Text color={selected ? c.selected : c.muted}>{selected ? "▶ " : "  "}</Text>;
}

/** Distinct error line. */
/**
 * Condense an error for display. Protocol failures arrive as `"<code>: <message>"` where the
 * message can be a pretty-printed zod issue array — dozens of lines of JSON that filled the
 * whole list panel, one token per line, and buried what actually went wrong. Pull out the
 * field paths and state them in one line instead.
 */
export function formatError(raw: string): string {
  const codeMatch = /^(-?\d+):\s*/.exec(raw);
  const code = codeMatch ? codeMatch[1] : null;
  const body = codeMatch ? raw.slice(codeMatch[0].length) : raw;

  let detail = body.trim();
  if (detail.startsWith("[") || detail.startsWith("{")) {
    try {
      const parsed = JSON.parse(detail);
      const issues = (Array.isArray(parsed) ? parsed : [parsed]) as {
        path?: (string | number)[];
        message?: string;
      }[];
      const described = issues
        .filter((i) => i && (i.path || i.message))
        .map((i) => `${(i.path ?? []).join(".") || "response"}: ${i.message ?? "invalid"}`);
      if (described.length) {
        const [first, ...rest] = described;
        detail = rest.length ? `${first} (+${rest.length} more)` : first;
      }
    } catch {
      // Not JSON after all — fall through and show the raw text, collapsed below.
    }
  }
  // Any remaining multi-line text collapses to its first meaningful line: the panel is one
  // row tall for errors, so extra lines only push the rest of the UI around.
  detail = detail.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? detail;
  return code ? `${code} ${detail}` : detail;
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <Text color={c.danger} wrap="truncate-end">
      ✗ {formatError(message)}
    </Text>
  );
}

/** Distinct empty-state line. */
export function EmptyLine({ label }: { label: string }) {
  return <Text color={c.muted}>{label}</Text>;
}

/** Distinct loading line. */
export function Loading({ label = "loading…" }: { label?: string }) {
  return <Text color={c.muted}>{label}</Text>;
}

/** Host lifecycle state for the stats bar: running/stopping phases, terminal state. */
export function HostStatusView({
  status,
  error = null,
}: {
  status: HostStatus | null;
  error?: string | null;
}) {
  if (error) {
    return (
      <Text color={c.danger}>
        host error: {error}
      </Text>
    );
  }
  if (!status) return <Text color={c.muted}>host …</Text>;
  const { state, phase, extensionId } = status;
  if (state === "running") {
    return (
      <Text>
        <Text color={c.warning}>running {extensionId}</Text>
        {phase ? <Text color={c.muted}> ({phase})</Text> : null}
      </Text>
    );
  }
  if (state === "stopping") {
    return <Text color={c.warning}>stopping {extensionId}</Text>;
  }
  if (phase === "done") {
    return (
      <Text>
        <Text color={c.success}>done</Text>
        <Text color={c.muted}> {extensionId}</Text>
      </Text>
    );
  }
  if (phase === "failed") {
    return <Text color={c.danger}>failed {extensionId}</Text>;
  }
  if (phase === "stopped") {
    return (
      <Text>
        <Text color={c.warning}>stopped</Text>
        <Text color={c.muted}> {extensionId}</Text>
      </Text>
    );
  }
  return <Text color={c.muted}>idle</Text>;
}

/**
 * A fixed host-log dock above the status bar. Fully hidden by default: it
 * renders nothing until the user opens it with 'l', then expands to the full
 * message. A subtle 'show' hint also renders when closed if a message exists,
 * so the dock stays discoverable without occupying space.
 */
export function LogView({
  status,
  lines,
  error = null,
}: {
  status: HostStatus | null;
  lines: LogLine[];
  error?: string | null;
}) {
  const { stdout } = useStdout();
  const failed = status?.phase === "failed";
  if (error) {
    return <Text color={c.danger}>host error: {error}</Text>;
  }
  // Tail the log to the terminal: keep the newest lines that fit, note the rest.
  // Floor of 1, not 5: a five-row floor made the log frame 16 rows tall regardless of the
  // terminal, so short terminals lost the top of the UI off screen.
  const visible = Math.max(1, (stdout.rows ?? 24) - 11);
  const shown = lines.slice(-visible);
  const omitted = lines.length - shown.length;
  const fallback = lines.length === 0 ? status?.message : null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold>{status?.phase ? `host log (${status.phase})` : "host log"}</Text>
        <Text color={c.muted}>esc back</Text>
      </Box>
      <Rule marginTop={1} />
      {omitted > 0 ? <Text color={c.muted}>… {omitted} earlier lines omitted</Text> : null}
      {shown.length > 0 ? (
        shown.map((line) => (
          <Text key={line.seq} color={line.stream === "stderr" ? c.danger : undefined}>
            {line.text}
          </Text>
        ))
      ) : (
        <Text color={failed ? c.danger : undefined} dimColor={!failed && !fallback}>
          {fallback ?? "(no output from the host yet)"}
        </Text>
      )}
    </Box>
  );
}

/**
 * A filled block bar for a ratio in [0, 1]. "█" shows the filled portion,
 * "░" the remainder. Used for scores and the breakdown.
 */
export function bar(ratio: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** A score bar (0..100) of the given width. */
export function scoreBar(score: number, width = 10): string {
  return bar(score / 100, width);
}

/** Color tone for an interestingness score. High pops, low recedes. */
export function scoreTone(score: number): string {
  if (score >= 70) return c.scoreHigh;
  if (score >= 40) return c.scoreMedium;
  return c.scoreLow;
}

/** Renders text with the query substring highlighted. */
export function Highlight({
  text,
  query,
  bold = false,
}: {
  text: string;
  query: string;
  bold?: boolean;
}) {
  const q = query.trim();
  if (!q) return <Text bold={bold}>{text}</Text>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <Text bold={bold}>{text}</Text>;
  return (
    <Text bold={bold}>
      {text.slice(0, idx)}
      <Text color={c.highlight} bold>
        {text.slice(idx, idx + q.length)}
      </Text>
      {text.slice(idx + q.length)}
    </Text>
  );
}

function KeyRow({ keys, action }: { keys: string; action: string }) {
  return (
    <Text>
      <Text color={c.accent}>{keys.padEnd(17)}</Text>
      <Text color={c.muted}>{action}</Text>
    </Text>
  );
}

const HELP_GROUPS: [string, [string, string][]][] = [
  [
    "navigation",
    [
      ["↑/↓ or j/k", "select extension"],
      ["g / G", "first / last row"],
      ["enter", "open analyzer"],
      ["esc", "back to explorer"],
    ],
  ],
  [
    "explorer",
    [
      ["/", "search by name"],
      ["ctrl+u", "clear search"],
      ["s", "cycle sort"],
      ["n/p or pgup/pgdn", "previous / next page"],
      ["m", "migrate all / stop host job"],
    ],
  ],
  [
    "analyzer",
    [
      ["↑/↓ or j/k", "scroll"],
      ["b", "launch test browsers"],
      ["x", "close browsers"],
      ["r", "record a report"],
    ],
  ],
  [
    "global",
    [
      ["l", "host log"],
      ["?", "this help"],
      ["q", "quit"],
    ],
  ],
  // The list's status column is a single glyph with no room for a label, so the only place
  // its meaning can live is here.
  [
    "list markers",
    [
      ["✓", "a report has been recorded"],
      ["↑", "an MV3 migration exists (no report yet)"],
      ["score", "interestingness: green high, yellow medium, red low"],
    ],
  ],
];

/** Full-screen keyboard reference, toggled with '?'. Scrolls when it is
 * taller than the terminal so every row stays reachable. */
export function HelpView() {
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;
  const visible = Math.max(6, rows - 6);
  const [scroll, setScroll] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === "k") setScroll((s) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setScroll((s) => s + 1);
    else if (input === "g") setScroll(0);
    else if (input === "G") setScroll(1000000);
  });

  const lines: React.ReactNode[] = [
    <Text key="title">
      <Text bold>keyboard help</Text>
      <Text color={c.muted}>  esc or ? to close</Text>
    </Text>,
  ];
  for (const [title, pairs] of HELP_GROUPS) {
    lines.push(
      <Text key={title} bold color={c.warning}>
        {title}
      </Text>,
    );
    for (const [keys, action] of pairs) {
      lines.push(<KeyRow key={`${title}:${keys}`} keys={keys} action={action} />);
    }
    lines.push(<Text key={`${title}:gap`}> </Text>);
  }

  const overflowing = lines.length > visible;
  const content = overflowing ? visible - 1 : visible;
  const start = Math.min(scroll, Math.max(0, lines.length - content));
  const shown = lines.slice(start, start + content);

  return (
    <Box flexDirection="column">
      {shown.map((node, i) => (
        <React.Fragment key={i}>{node}</React.Fragment>
      ))}
      {overflowing ? (
        <Text color={c.muted}>
          … {start + 1}-{start + content}/{lines.length} · ↑/↓ or j/k to scroll
        </Text>
      ) : null}
    </Box>
  );
}
