/**
 * How much longer a batch has to run.
 *
 * A migration takes tens of minutes per extension and a batch runs for a day, so "running" on its
 * own tells the watcher nothing. The estimate is the crudest possible — elapsed divided by
 * finished, times what is left — and that is deliberate: per-extension time varies by an order of
 * magnitude (a 16-minute migration and a 60-minute one sat next to each other in the same run), so
 * a cleverer model would be precise about a number that is inherently rough.
 *
 * It refuses to guess from a single sample. One finished extension says almost nothing about the
 * next forty, and a confident wrong ETA is worse than none.
 */
const MIN_SAMPLES = 2;

export interface Eta {
    /** Fraction complete in [0, 1]. */
    fraction: number;
    /** Human estimate of time remaining, or null when there is not enough evidence yet. */
    remaining: string | null;
    /** Mean wall-clock per finished extension, or null. */
    perItem: string | null;
}

/** "2h 15m", "45m", "30s" — one unit of precision, because the estimate does not deserve two. */
export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 90) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

export function estimate(
    progress: { done: number; total: number; startedAt: string | null } | null | undefined,
    now = Date.now(),
): Eta | null {
    if (!progress || progress.total <= 0) return null;
    const fraction = Math.min(1, progress.done / progress.total);

    const started = progress.startedAt ? Date.parse(progress.startedAt) : NaN;
    if (!Number.isFinite(started) || progress.done < MIN_SAMPLES) {
        return { fraction, remaining: null, perItem: null };
    }

    const perItemMs = (now - started) / progress.done;
    const left = progress.total - progress.done;
    return {
        fraction,
        remaining: left > 0 ? formatDuration(perItemMs * left) : null,
        perItem: formatDuration(perItemMs),
    };
}
