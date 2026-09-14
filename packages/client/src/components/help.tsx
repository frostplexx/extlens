/**
 * The keyboard reference, generated from KEYMAP.
 *
 * Nothing here is hand-written: every row comes from the same table the dispatcher reads, so a
 * binding cannot exist without appearing here, and a row cannot claim a key that does nothing.
 * The list markers are the exception — they are glyphs in the list, not keys, and the list has no
 * room to label them, so this is the only place their meaning can live.
 */
import React from "react";
import { Box, Text } from "ink";
import { helpGroups } from "../keys/keymap.js";
import { c } from "../theme.js";
import { ScrollView } from "./ui.js";

const KEY_COLUMN = 18;

/** Glyphs the explorer list draws but has no space to caption. */
const MARKERS: [string, string][] = [
    ["✓", "a report has been recorded"],
    ["↑", "an MV3 migration exists (no report yet)"],
    ["score", "interestingness: green high, yellow medium, red low"],
];

function KeyRow({ keys, action }: { keys: string; action: string }) {
    return (
        <Text>
            <Text color={c.accent}>{keys.padEnd(KEY_COLUMN)}</Text>
            <Text color={c.subtext}>{action}</Text>
        </Text>
    );
}

export function HelpView({ height = 18, scroll = 0 }: { height?: number; scroll?: number }) {
    const lines: React.ReactNode[] = [];
    for (const { group, rows } of helpGroups()) {
        lines.push(
            <Text key={group} bold color={c.warning}>
                {group}
            </Text>,
        );
        for (const row of rows) {
            lines.push(<KeyRow key={`${group}:${row.keys}:${row.label}`} keys={row.keys} action={row.label} />);
        }
        lines.push(<Text key={`${group}:gap`}> </Text>);
    }
    lines.push(
        <Text key="markers" bold color={c.warning}>
            list markers
        </Text>,
    );
    for (const [glyph, meaning] of MARKERS) {
        lines.push(<KeyRow key={`marker:${glyph}`} keys={glyph} action={meaning} />);
    }

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold color={c.panelTitle}>
                    keyboard help
                </Text>
                <Text color={c.muted}>  esc or ? to close</Text>
            </Text>
            <ScrollView lines={lines} height={Math.max(4, height - 1)} scroll={scroll} />
        </Box>
    );
}
