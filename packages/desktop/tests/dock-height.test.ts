/**
 * The dock could be dragged smaller but never larger, twice, for reasons that only appeared on
 * screen. The arithmetic is now a pure function so at least this part is proven rather than
 * observed.
 */
import { describe, expect, it } from "vitest";
import { clampDockHeight, heightAfterDrag, MIN_DOCK_HEIGHT, MIN_WORKING_HEIGHT } from "../src/renderer/lib/dock-height";

const VIEWPORT = 900;

describe("dragging the top edge", () => {
    it("grows the dock when dragged up", () => {
        // The bug: this direction did nothing.
        expect(heightAfterDrag(224, -150, VIEWPORT)).toBe(374);
    });

    it("shrinks the dock when dragged down", () => {
        expect(heightAfterDrag(400, 150, VIEWPORT)).toBe(250);
    });

    it("is symmetric — a drag and its reverse return to the start", () => {
        const grown = heightAfterDrag(300, -120, VIEWPORT);
        expect(heightAfterDrag(grown, 120, VIEWPORT)).toBe(300);
    });
});

describe("limits", () => {
    it("never shrinks below a usable log", () => {
        expect(heightAfterDrag(150, 500, VIEWPORT)).toBe(MIN_DOCK_HEIGHT);
    });

    it("always leaves the working area room", () => {
        expect(heightAfterDrag(300, -5000, VIEWPORT)).toBe(VIEWPORT - MIN_WORKING_HEIGHT);
    });

    it("prefers a usable log over the working-area floor in a tiny window", () => {
        // Both limits cannot hold at 250px tall; the one the user is dragging wins.
        expect(clampDockHeight(400, 250)).toBe(MIN_DOCK_HEIGHT);
    });

    it("clamps a stored height when the window has since shrunk", () => {
        expect(clampDockHeight(700, 500)).toBe(300);
    });
});
