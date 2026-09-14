/**
 * Turning per-surface observations into a score and a verdict.
 *
 * This lives in the protocol, not in a client, because the number has to mean the same thing
 * wherever it was recorded: a corpus where half the scores came from the terminal client and half
 * from the web UI is only comparable if both computed them the same way.
 *
 * The rule in one line: score is the share of *testable* surfaces that survived, and a surface
 * nobody could test is excluded from the denominator rather than counted as a failure.
 */
import type { ExtensionVerdict, SurfaceResult, SurfaceStatus } from "./types.js";

/** What each status contributes to the score. Untestable and untested are not in the denominator. */
const CREDIT: Record<SurfaceStatus, number | null> = {
    working: 1,
    partial: 0.5,
    broken: 0,
    not_testable: null,
    untested: null,
};

export interface SurfaceScore {
    /** Share of testable surfaces preserved, or null when nothing could be tested. */
    score: number | null;
    /** Surfaces that counted — the denominator. */
    testable: number;
    working: number;
    partial: number;
    broken: number;
    notTestable: number;
    untested: number;
}

export function scoreSurfaces(surfaces: SurfaceResult[]): SurfaceScore {
    const counts = { working: 0, partial: 0, broken: 0, notTestable: 0, untested: 0 };
    let credit = 0;
    let testable = 0;

    for (const result of surfaces) {
        switch (result.status) {
            case "working":
                counts.working++;
                break;
            case "partial":
                counts.partial++;
                break;
            case "broken":
                counts.broken++;
                break;
            case "not_testable":
                counts.notTestable++;
                break;
            default:
                counts.untested++;
        }
        const value = CREDIT[result.status];
        if (value === null) continue;
        credit += value;
        testable++;
    }

    return {
        score: testable === 0 ? null : credit / testable,
        testable,
        working: counts.working,
        partial: counts.partial,
        broken: counts.broken,
        notTestable: counts.notTestable,
        untested: counts.untested,
    };
}

/**
 * The four-state verdict implied by a set of surface results.
 *
 * "Partially working" is deliberately easy to reach: one broken surface among working ones is
 * exactly the outcome the old tri-state forced a reviewer to round away, and rounding it toward
 * either end is what makes a migration success rate untrustworthy.
 */
export function verdictFor(surfaces: SurfaceResult[]): ExtensionVerdict {
    const { score, testable, working, partial } = scoreSurfaces(surfaces);
    if (testable === 0 || score === null) return "not_testable";
    if (score === 1) return "working";
    // Nothing survived at all, not even partially: a total loss rather than a degraded one.
    if (working === 0 && partial === 0) return "not_working";
    return "partially_working";
}

/** Human label for a verdict, shared so both clients word it identically. */
export const VERDICT_LABELS: Record<ExtensionVerdict, string> = {
    working: "Working",
    partially_working: "Partially working",
    not_working: "Not working",
    not_testable: "Not testable",
};
