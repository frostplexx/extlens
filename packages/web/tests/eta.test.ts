/**
 * The ETA is watched for hours, so its failure mode matters more than its accuracy: it must not
 * invent a number it cannot support.
 */
import { describe, expect, it } from "vitest";
import { estimate, formatDuration } from "../src/lib/eta";

const start = "2026-09-15T12:00:00.000Z";
const at = (minutes: number) => Date.parse(start) + minutes * 60_000;

describe("progress", () => {
    it("reports the fraction done", () => {
        expect(estimate({ done: 5, total: 20, startedAt: start }, at(100))?.fraction).toBe(0.25);
    });

    it("has nothing to report without a batch", () => {
        expect(estimate(null)).toBeNull();
        expect(estimate({ done: 0, total: 0, startedAt: start })).toBeNull();
    });
});

describe("the estimate itself", () => {
    it("extrapolates from the mean so far", () => {
        // 4 done in 80 minutes = 20 min each; 16 left = 320 min.
        const eta = estimate({ done: 4, total: 20, startedAt: start }, at(80));
        expect(eta?.perItem).toBe("20m");
        expect(eta?.remaining).toBe("5h 20m");
    });

    it("refuses to guess from a single sample", () => {
        // One extension says almost nothing about the next forty, and a confident wrong ETA is
        // worse than none.
        expect(estimate({ done: 1, total: 40, startedAt: start }, at(30))?.remaining).toBeNull();
    });

    it("says nothing rather than something wrong when the start time is missing", () => {
        expect(estimate({ done: 5, total: 10, startedAt: null }, at(50))?.remaining).toBeNull();
    });

    it("stops estimating once the batch is finished", () => {
        const eta = estimate({ done: 10, total: 10, startedAt: start }, at(100));
        expect(eta?.fraction).toBe(1);
        expect(eta?.remaining).toBeNull();
    });
});

describe("durations read at a glance", () => {
    it("uses one unit, because the estimate does not deserve two", () => {
        expect(formatDuration(45_000)).toBe("45s");
        expect(formatDuration(20 * 60_000)).toBe("20m");
        expect(formatDuration(195 * 60_000)).toBe("3h 15m");
    });
});

describe("counting down rather than drifting up", () => {
    const batch = "2026-09-15T12:00:00.000Z";
    const t = (minutes: number) => Date.parse(batch) + minutes * 60_000;
    const iso = (minutes: number) => new Date(t(minutes)).toISOString();

    it("charges the running extension's time to itself, not to the rate", () => {
        // 2 done in the 40 minutes before the current one started = 20m each. 8 left = 160m,
        // minus the 5m already spent on the one running.
        const eta = estimate({ done: 2, total: 10, startedAt: batch }, t(45), iso(40));
        expect(eta?.perItem).toBe("20m");
        expect(eta?.remaining).toBe("2h 35m");
    });

    it("falls as time passes within one extension", () => {
        const progress = { done: 2, total: 10, startedAt: batch };
        const early = estimate(progress, t(41), iso(40))?.remaining;
        const later = estimate(progress, t(55), iso(40))?.remaining;
        // The bug: this used to grow, because the running item's time inflated the mean.
        expect(early).toBe("2h 39m");
        expect(later).toBe("2h 25m");
    });

    it("never goes negative when an extension runs long", () => {
        expect(estimate({ done: 9, total: 10, startedAt: batch }, t(500), iso(90))?.remaining).toBe("0s");
    });

    it("still estimates, drifting, when the host reports no item start", () => {
        expect(estimate({ done: 2, total: 10, startedAt: batch }, t(40))?.remaining).toBe("2h 40m");
    });
});
