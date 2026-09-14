/**
 * Score and verdict are the headline numbers of a manual validation pass, so the cases that
 * matter are the ones where a careless rule would quietly lie: untestable surfaces, a single
 * broken surface among working ones, and an extension nobody could test at all.
 */
import { describe, expect, it } from "vitest";
import type { SurfaceResult, SurfaceStatus, UiSurface } from "../src/index.js";
import { scoreSurfaces, verdictFor } from "../src/index.js";

const r = (surface: UiSurface, status: SurfaceStatus): SurfaceResult => ({ surface, status, note: "" });

describe("scoring surfaces", () => {
    it("scores the share of testable surfaces that survived", () => {
        expect(scoreSurfaces([r("popup", "working"), r("options_page", "broken")]).score).toBe(0.5);
    });

    it("counts a partially working surface as a half", () => {
        expect(scoreSurfaces([r("popup", "partial"), r("options_page", "working")]).score).toBe(0.75);
    });

    it("excludes untestable surfaces from the denominator rather than failing them", () => {
        // A popup behind a paid login is evidence about the harness, not about the migration.
        const score = scoreSurfaces([r("popup", "not_testable"), r("options_page", "working")]);
        expect(score.score).toBe(1);
        expect(score.testable).toBe(1);
        expect(score.notTestable).toBe(1);
    });

    it("returns null, not zero, when nothing could be tested", () => {
        // Zero would be indistinguishable from "everything was broken", which is the opposite claim.
        expect(scoreSurfaces([r("popup", "not_testable")]).score).toBeNull();
        expect(scoreSurfaces([]).score).toBeNull();
    });

    it("does not let an unanswered surface count either way", () => {
        const score = scoreSurfaces([r("popup", "working"), r("context_menu", "untested")]);
        expect(score.score).toBe(1);
        expect(score.untested).toBe(1);
    });
});

describe("verdicts", () => {
    it("calls it working only when every testable surface works", () => {
        expect(verdictFor([r("popup", "working"), r("context_menu", "working")])).toBe("working");
    });

    it("calls one broken surface among working ones partially working", () => {
        // The outcome the old tri-state forced a reviewer to round to a success or a total loss.
        expect(verdictFor([r("popup", "working"), r("context_menu", "broken")])).toBe("partially_working");
    });

    it("treats a partial surface as partial working, not as a pass", () => {
        expect(verdictFor([r("popup", "partial")])).toBe("partially_working");
    });

    it("calls it not working when nothing survived at all", () => {
        expect(verdictFor([r("popup", "broken"), r("context_menu", "broken")])).toBe("not_working");
    });

    it("calls it not testable when no surface could be judged", () => {
        expect(verdictFor([r("popup", "not_testable"), r("context_menu", "untested")])).toBe("not_testable");
        expect(verdictFor([])).toBe("not_testable");
    });
});
