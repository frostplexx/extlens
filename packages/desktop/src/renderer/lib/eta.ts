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
 *
 * It also has to count DOWN. The obvious formula — total elapsed over finished items — drifts
 * upward between completions, because the numerator keeps growing while the denominator does not:
 * time spent on the extension currently running gets charged to the ones already done. Watching an
 * estimate climb for forty minutes and then jump back is worse than useless, so the rate is taken
 * from finished work only (batch start to current item start) and the time already spent on the
 * running item is subtracted from what remains.
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
    /** When the extension currently running began, so its elapsed time is not charged to the rate. */
    currentStartedAt?: string | null,
): Eta | null {
    if (!progress || progress.total <= 0) return null;
    const fraction = Math.min(1, progress.done / progress.total);

    const batchStart = progress.startedAt ? Date.parse(progress.startedAt) : NaN;
    if (!Number.isFinite(batchStart) || progress.done < MIN_SAMPLES) {
        return { fraction, remaining: null, perItem: null };
    }

    const itemStart = currentStartedAt ? Date.parse(currentStartedAt) : NaN;
    const haveItemStart = Number.isFinite(itemStart) && itemStart >= batchStart;

    // Finished work only. Without an item start we fall back to total elapsed, which is the drifting
    // version — still better than nothing, and it stops drifting the moment the host reports one.
    const finishedMs = haveItemStart ? itemStart - batchStart : now - batchStart;
    const perItemMs = finishedMs / progress.done;

    const left = progress.total - progress.done;
    if (left <= 0) return { fraction, remaining: null, perItem: formatDuration(perItemMs) };

    const spentOnCurrent = haveItemStart ? now - itemStart : 0;
    const remainingMs = Math.max(0, perItemMs * left - spentOnCurrent);
    return { fraction, remaining: formatDuration(remainingMs), perItem: formatDuration(perItemMs) };
}
