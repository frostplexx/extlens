/**
 * The host log: a tail of the running migration's output.
 *
 * The tail is clamped to the terminal and the omitted count is stated explicitly, because a log
 * that silently drops its beginning looks identical to a log that never had one.
 */
import React from "react";
import { Box, Text } from "ink";
import type { HostStatus, LogLine } from "@extlens/protocol";
import { c } from "../theme.js";
import { Rule } from "./ui.js";

export function LogView({
    status,
    lines,
    error = null,
    /**
     * Total rows this view may occupy, chrome included. The caller owns the frame's vertical
     * budget and should not have to know how many rows the title, rule and overflow notice take.
     */
    height = 12,
}: {
    status: HostStatus | null;
    lines: LogLine[];
    error?: string | null;
    height?: number;
}) {
    if (error) return <Text color={c.danger}>host error: {error}</Text>;

    const failed = status?.phase === "failed";
    // Own chrome: the spacer row, the title and the rule; plus the "earlier lines omitted"
    // notice, reserved whenever there are lines at all so adding it can never overflow.
    const chrome = 3 + (lines.length > 0 ? 1 : 0);
    const visible = Math.max(1, height - chrome);
    const shown = lines.slice(-visible);
    const omitted = lines.length - shown.length;
    // Before the first line arrives, the status message is the only thing there is to show.
    const fallback = lines.length === 0 ? status?.message : null;

    return (
        <Box flexDirection="column" marginTop={1}>
            <Box justifyContent="space-between">
                <Text bold color={c.panelTitle}>
                    {status?.phase ? `host log (${status.phase})` : "host log"}
                </Text>
                <Text color={c.muted}>esc back</Text>
            </Box>
            <Rule />
            {omitted > 0 ? <Text color={c.muted}>… {omitted} earlier lines omitted</Text> : null}
            {shown.length > 0 ? (
                shown.map((line) => (
                    <Text key={line.seq} color={line.stream === "stderr" ? c.danger : undefined} wrap="truncate-end">
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
