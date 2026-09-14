/**
 * The single source of truth for keyboard input.
 *
 * Before this module the same binding lived in three places that could disagree: the dispatch
 * chain in app.tsx, the `hints` string in the status bar, and HELP_GROUPS in ui.tsx. Adding a
 * key meant editing all three, and forgetting one produced a key that worked but was
 * undiscoverable (or, worse, a hint for a key that did nothing).
 *
 * Here a binding is data: which chords trigger it, which scope it belongs to, and how it reads
 * in the footer and the help screen. Dispatch, the footer hints and the help screen are all
 * derived from this table, so they cannot drift apart.
 */
import type { Key } from "ink";

/** Where a binding applies. `global` bindings work in every scope that does not swallow input. */
export type Scope = "global" | "explorer" | "analyzer" | "log";

/** Action identifiers. A view supplies handlers keyed by these; unhandled ids are inert. */
export type ActionId =
    | "quit"
    | "help"
    | "log"
    | "back"
    | "up"
    | "down"
    | "top"
    | "bottom"
    | "open"
    | "search"
    | "sort"
    | "nextPage"
    | "prevPage"
    | "toggleHost"
    | "launchBrowsers"
    | "closeBrowsers"
    | "report";

export interface Binding {
    id: ActionId;
    /** Chords that trigger it. See `matches` for the accepted token grammar. */
    keys: string[];
    /** Help-screen wording, lower case and imperative: "open analyzer", not "Opens the analyzer". */
    label: string;
    scope: Scope;
    /** Help-screen grouping, and the order groups appear in. */
    group: string;
    /**
     * Footer wording, which is not the same text as `label`: the footer has one line and shows
     * the chord inline ("enter open"), while help has a chord column and needs a fuller phrase
     * ("open the analyzer"). Omit it to keep the binding live but out of the footer — the right
     * choice for aliases (`k` next to `up`) that would only repeat their partner.
     */
    hint?: string;
}

/**
 * Chord grammar: a bare character ("j", "?"), a named key ("up", "enter", "esc", "pgdn"),
 * or a modifier prefix ("ctrl+u"). Everything the client binds fits this; there is deliberately
 * no support for arbitrary sequences, because a discoverable TUI should not have any.
 */
const NAMED: Record<string, (key: Key) => boolean> = {
    up: (k) => k.upArrow,
    down: (k) => k.downArrow,
    left: (k) => k.leftArrow,
    right: (k) => k.rightArrow,
    enter: (k) => k.return,
    esc: (k) => k.escape,
    tab: (k) => k.tab,
    backspace: (k) => k.backspace || k.delete,
    pgup: (k) => k.pageUp,
    pgdn: (k) => k.pageDown,
};

/** Does one chord token match this keypress? */
export function matchesChord(chord: string, input: string, key: Key): boolean {
    const ctrl = chord.startsWith("ctrl+");
    const token = ctrl ? chord.slice(5) : chord;
    if (ctrl) return key.ctrl && input === token;
    // A modified keypress never matches a bare character chord: ctrl+c must not fire "c".
    const named = NAMED[token];
    if (named) return named(key);
    return !key.ctrl && !key.meta && input === token;
}

/** The first binding in `bindings` whose scope is active and whose chord matches, or null. */
export function resolve(bindings: Binding[], scope: Scope, input: string, key: Key): ActionId | null {
    for (const b of bindings) {
        if (b.scope !== "global" && b.scope !== scope) continue;
        if (b.keys.some((chord) => matchesChord(chord, input, key))) return b.id;
    }
    return null;
}

/**
 * The keymap. Scoped bindings come first so a view can shadow a global chord (the analyzer's
 * 'l' would otherwise be eaten by the global log toggle).
 */
export const KEYMAP: Binding[] = [
    // explorer
    { id: "up", keys: ["up", "k"], label: "select previous", scope: "explorer", group: "navigation", hint: "↑/↓ select" },
    { id: "down", keys: ["down", "j"], label: "select next", scope: "explorer", group: "navigation" },
    { id: "top", keys: ["g"], label: "jump to first row", scope: "explorer", group: "navigation", hint: "g/G first/last" },
    { id: "bottom", keys: ["G"], label: "jump to last row", scope: "explorer", group: "navigation" },
    { id: "open", keys: ["enter"], label: "open the analyzer", scope: "explorer", group: "navigation", hint: "enter open" },
    { id: "search", keys: ["/"], label: "search by name", scope: "explorer", group: "explorer", hint: "/ search" },
    { id: "sort", keys: ["s"], label: "cycle the sort order", scope: "explorer", group: "explorer", hint: "s sort" },
    { id: "nextPage", keys: ["pgdn", "n"], label: "next page", scope: "explorer", group: "explorer", hint: "n/p page" },
    { id: "prevPage", keys: ["pgup", "p"], label: "previous page", scope: "explorer", group: "explorer" },
    { id: "toggleHost", keys: ["m"], label: "migrate all / stop the host job", scope: "explorer", group: "explorer", hint: "m migrate" },

    // analyzer
    { id: "up", keys: ["up", "k"], label: "scroll up", scope: "analyzer", group: "analyzer", hint: "↑/↓ scroll" },
    { id: "down", keys: ["down", "j"], label: "scroll down", scope: "analyzer", group: "analyzer" },
    { id: "top", keys: ["g"], label: "scroll to top", scope: "analyzer", group: "analyzer" },
    { id: "bottom", keys: ["G"], label: "scroll to bottom", scope: "analyzer", group: "analyzer" },
    { id: "launchBrowsers", keys: ["b"], label: "launch the MV2/MV3 test browsers", scope: "analyzer", group: "analyzer", hint: "b browsers" },
    { id: "closeBrowsers", keys: ["x"], label: "close the test browsers", scope: "analyzer", group: "analyzer", hint: "x close" },
    { id: "report", keys: ["r"], label: "record a verification report", scope: "analyzer", group: "analyzer", hint: "r report" },
    { id: "back", keys: ["esc", "backspace"], label: "back to the explorer", scope: "analyzer", group: "navigation", hint: "esc back" },

    // log
    { id: "up", keys: ["up", "k"], label: "scroll up", scope: "log", group: "log", hint: "↑/↓ scroll" },
    { id: "down", keys: ["down", "j"], label: "scroll down", scope: "log", group: "log" },
    { id: "back", keys: ["esc", "backspace"], label: "back to the explorer", scope: "log", group: "navigation", hint: "esc back" },

    // global
    { id: "log", keys: ["l"], label: "open the host log", scope: "global", group: "global", hint: "l log" },
    { id: "help", keys: ["?"], label: "this help", scope: "global", group: "global", hint: "? help" },
    { id: "quit", keys: ["q"], label: "quit", scope: "global", group: "global", hint: "q quit" },
];

/** Footer hints for a scope: bindings that carry a `hint`, in table order. */
export function hintsFor(scope: Scope): string {
    return KEYMAP.filter((b) => (b.scope === scope || b.scope === "global") && b.hint)
        .map((b) => b.hint as string)
        .join(" · ");
}

/** Help-screen rows: groups in first-seen order, each chord list paired with its label. */
export function helpGroups(): { group: string; rows: { keys: string; label: string }[] }[] {
    const order: string[] = [];
    const byGroup = new Map<string, { keys: string; label: string }[]>();
    for (const b of KEYMAP) {
        if (!byGroup.has(b.group)) {
            byGroup.set(b.group, []);
            order.push(b.group);
        }
        byGroup.get(b.group)!.push({ keys: b.keys.join(" / "), label: b.label });
    }
    return order.map((group) => ({ group, rows: byGroup.get(group)! }));
}
