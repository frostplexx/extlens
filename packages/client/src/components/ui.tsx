/**
 * Shared presentational primitives.
 *
 * Everything here is pure: props in, ink nodes out, no RPC and no state beyond what a widget
 * needs to draw itself. Layout arithmetic lives in ../layout.ts and keyboard data in
 * ../keys/keymap.ts, so this file never has to know how tall the frame is or which key does what.
 */
import React from "react";
import { Box, Text, useStdout } from "ink";
import type { HostStatus } from "@extlens/protocol";
import { MIN_ROWS } from "../layout.js";
import { c } from "../theme.js";

const RULE = "─";

/** Terminal width, with a sane fallback for headless renders. */
export function useColumns(): number {
    const { stdout } = useStdout();
    return stdout.columns ?? 80;
}

/** A full-width dim horizontal rule. */
export function Rule({ marginTop = 0, marginBottom = 0 }: { marginTop?: number; marginBottom?: number }) {
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
    height,
}: {
    title?: string;
    children: React.ReactNode;
    color?: string;
    titleColor?: string;
    /** Fixed outer width in columns; undefined shrinks to content. */
    width?: number;
    /**
     * Fixed outer height in rows; undefined shrinks to content.
     *
     * A fixed height is how a panel stops the frame from breathing as its contents change. The
     * alternative — padding the children out to a target count — gives the same result only as
     * long as every child is exactly one row tall, which stops being true the moment something
     * wraps, and fails silently when it does.
     */
    height?: number;
}) {
    return (
        <Box
            borderStyle="round"
            borderColor={color}
            flexDirection="column"
            paddingX={1}
            width={width}
            height={height}
            overflow="hidden"
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
export function Section({ title, hint, marginTop = 1 }: { title: string; hint?: string; marginTop?: number }) {
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
 * The app's one-line header: brand, the screen you are on, and the connection state.
 *
 * It is one row, not a bordered box, because those two extra rows came out of the extension list
 * on every screen — and a border around a single static line is decoration that costs content.
 * The breadcrumb replaces what the border was really for: telling you where you are.
 */
export function TopBar({
    status,
    scope,
}: {
    status: "connecting" | "connected" | "disconnected";
    /** Current screen, shown as a breadcrumb after the brand. */
    scope?: string;
}) {
    const statusColor =
        status === "connected" ? c.connected : status === "connecting" ? c.connecting : c.disconnected;
    return (
        <Box justifyContent="space-between" paddingX={1}>
            <Text>
                <Text color={c.brand} bold>
                    extlens
                </Text>
                {scope ? (
                    <Text color={c.muted}>
                        {"  ›  "}
                        <Text color={c.subtext}>{scope}</Text>
                    </Text>
                ) : null}
            </Text>
            <Text>
                <Text color={statusColor}>{status === "connecting" ? "◐" : "●"}</Text>
                <Text color={c.muted}> {status}</Text>
            </Text>
        </Box>
    );
}

/** Row marker: ▶ for the selected row, blank space otherwise. */
export function Cursor({ selected }: { selected: boolean }) {
    return <Text color={selected ? c.selected : c.muted}>{selected ? "▶ " : "  "}</Text>;
}

/**
 * Condense an error for display. Protocol failures arrive as `"<code>: <message>"` where the
 * message can be a pretty-printed zod issue array — dozens of lines of JSON that filled the whole
 * list panel, one token per line, and buried what actually went wrong. Pull out the field paths
 * and state them in one line instead.
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
    // Any remaining multi-line text collapses to its first meaningful line: the panel is one row
    // tall for errors, so extra lines only push the rest of the UI around.
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
export function HostStatusView({ status, error = null }: { status: HostStatus | null; error?: string | null }) {
    if (error) return <Text color={c.danger}>host error: {error}</Text>;
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
    if (state === "stopping") return <Text color={c.warning}>stopping {extensionId}</Text>;
    if (phase === "done") {
        return (
            <Text>
                <Text color={c.success}>done</Text>
                <Text color={c.muted}> {extensionId}</Text>
            </Text>
        );
    }
    if (phase === "failed") return <Text color={c.danger}>failed {extensionId}</Text>;
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
 * A filled block bar for a ratio in [0, 1]. "█" shows the filled portion, "░" the remainder.
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
export function Highlight({ text, query, bold = false }: { text: string; query: string; bold?: boolean }) {
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

/** A scrolling window over pre-rendered lines, with a position indicator when it overflows. */
export function ScrollView({
    lines,
    height,
    scroll,
}: {
    lines: React.ReactNode[];
    height: number;
    scroll: number;
}) {
    const overflowing = lines.length > height;
    const content = overflowing ? height - 1 : height;
    const start = Math.min(scroll, Math.max(0, lines.length - content));
    const shown = lines.slice(start, start + content);
    return (
        <Box flexDirection="column">
            {shown.map((node, i) => (
                <React.Fragment key={start + i}>{node}</React.Fragment>
            ))}
            {overflowing ? (
                <Text color={c.muted}>
                    … {start + 1}-{start + shown.length}/{lines.length} · ↑/↓ or j/k to scroll
                </Text>
            ) : null}
        </Box>
    );
}
