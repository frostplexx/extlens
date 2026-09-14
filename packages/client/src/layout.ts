/**
 * Vertical budget for the frame.
 *
 * A terminal UI has a hard constraint a web UI does not: render one row more than the terminal
 * has and the top of the frame scrolls off screen permanently, because ink redraws in place.
 * The old code met that constraint with a single `CHROME_ROWS = 16` that had to be re-counted by
 * hand whenever any chrome element changed a row — and when it was wrong, the failure was a UI
 * that silently ate its own header.
 *
 * So the chrome is itemised instead. Each element states its own height next to the component
 * that draws it, the budget is their sum, and the list gets whatever is left. Change a component
 * and you change its constant here; nothing else needs re-counting.
 */

/** Height of each fixed element of the frame, in rows. */
export const CHROME = {
    /** TopBar: one line, no border. */
    topBar: 1,
    /** Stats + page/host line. */
    stats: 1,
    /** SearchBar: bordered box (2) + its content line (1). */
    search: 3,
    /** Panel border (2) + title (1) + column header (1). */
    listFrame: 4,
    /** StatusBar: rule (1) + hint line (1). */
    statusBar: 2,
    /**
     * Blank spacer rows: one above and one below the search bar, one above the status bar.
     * All three are dropped when compact, which is what buys a short terminal three list rows.
     */
    spacers: 3,
} as const;

const FIXED = CHROME.topBar + CHROME.stats + CHROME.search + CHROME.listFrame + CHROME.statusBar;

/** Rows of chrome around the list, with and without the optional spacers. */
export const CHROME_ROWS = FIXED + CHROME.spacers;
export const CHROME_ROWS_COMPACT = FIXED;

/** Below this even a one-row list overflows, so the client shows a notice instead of a broken frame. */
export const MIN_ROWS = CHROME_ROWS_COMPACT + 1;

/** A list longer than this stops being navigable by eye, and costs a full redraw per keypress. */
const MAX_PAGE_SIZE = 40;

/** True when the terminal is short enough that the blank spacer rows have to go. */
export function isCompact(rows?: number): boolean {
    return (rows ?? 24) < CHROME_ROWS + 5;
}

/**
 * Rows available for the explorer list at this terminal height.
 *
 * The floor is one row, not five: a five-row floor forced the frame to at least 21 rows, so every
 * terminal shorter than that rendered taller than the screen. Short terminals shrink the list.
 */
export function listPageSize(rows?: number): number {
    const chrome = isCompact(rows) ? CHROME_ROWS_COMPACT : CHROME_ROWS;
    return Math.max(1, Math.min(MAX_PAGE_SIZE, (rows ?? 24) - chrome));
}

/** Rows available to a full-screen scrolling view (analyzer, log, help). */
export function contentRows(rows?: number): number {
    return Math.max(1, (rows ?? 24) - CHROME.topBar - CHROME.statusBar - 1);
}

/** Below this a pane holds nothing but truncation ellipses, so the split stops trying. */
const MIN_PANE = 30;

/**
 * Split the terminal width into the explorer's list and details panes.
 *
 * The minimum is applied to the pair, not to each pane independently: clamping both to 30 in a
 * 60-column terminal produced 30 + gap + 30 = 61 columns of panes in 60 columns of terminal, and
 * ink resolved the overflow by wrapping the details pane under the list. When the width cannot
 * seat two legible panes, an even split is the honest answer.
 */
export function splitPanes(columns: number, gap = 1): { list: number; details: number } {
    const available = Math.max(0, columns - gap);
    if (available < MIN_PANE * 2) {
        const list = Math.floor(available / 2);
        return { list, details: available - list };
    }
    const list = Math.max(MIN_PANE, Math.floor(available / 2));
    return { list, details: available - list };
}
