/**
 * The propagation rule decides a whole form from one toggle, so what it must not do is lose a
 * judgement the reviewer made by hand.
 */
import { describe, expect, it } from "vitest";
import type { SurfaceResult } from "@extlens/protocol";
import { propagate } from "../src/lib/quick-assessment";

const surfaces = (...statuses: SurfaceResult["status"][]): SurfaceResult[] =>
    statuses.map((status, i) => ({ surface: (["popup", "options_page", "new_tab"] as const)[i], status, note: "" }));

const ok = { installs: true, needsLogin: false };

describe("nothing to propagate", () => {
    it("leaves the surfaces alone", () => {
        const before = surfaces("working", "broken");
        const after = propagate(before, ok, null);
        expect(after.surfaces).toBe(before);
        expect(after.because).toBeNull();
    });
});

describe("does not install", () => {
    it("marks every surface broken and says why", () => {
        const after = propagate(surfaces("untested", "working"), { installs: false, needsLogin: false }, null);
        expect(after.surfaces.map((s) => s.status)).toEqual(["broken", "broken"]);
        expect(after.surfaces.every((s) => s.note === "does not install")).toBe(true);
        expect(after.because).toMatch(/does not install/);
    });
});

describe("needs an account", () => {
    it("marks every surface untestable, which keeps them out of the denominator", () => {
        const after = propagate(surfaces("untested", "untested"), { installs: true, needsLogin: true }, null);
        expect(after.surfaces.map((s) => s.status)).toEqual(["not_testable", "not_testable"]);
        expect(after.because).toMatch(/can’t test/);
    });

    it("loses to a failed install, the more specific claim", () => {
        const after = propagate(surfaces("untested"), { installs: false, needsLogin: true }, null);
        expect(after.surfaces[0].status).toBe("broken");
    });
});

describe("undo", () => {
    it("restores the judgements a mis-click overwrote", () => {
        const judged = surfaces("working", "partial");
        const applied = propagate(judged, { installs: false, needsLogin: false }, null);
        const undone = propagate(applied.surfaces, ok, applied.snapshot);
        expect(undone.surfaces).toEqual(judged);
        expect(undone.snapshot).toBeNull();
    });

    it("keeps the original snapshot when a second rule fires", () => {
        // Re-snapshotting would capture the propagated values and make the undo a no-op.
        const judged = surfaces("working", "partial");
        const first = propagate(judged, { installs: false, needsLogin: false }, null);
        const second = propagate(first.surfaces, { installs: false, needsLogin: true }, first.snapshot);
        expect(second.snapshot).toEqual(judged);
        const undone = propagate(second.surfaces, ok, second.snapshot);
        expect(undone.surfaces).toEqual(judged);
    });
});

describe("notes", () => {
    it("never overwrites something the reviewer typed", () => {
        const typed: SurfaceResult[] = [{ surface: "popup", status: "broken", note: "throws on open" }];
        const after = propagate(typed, { installs: true, needsLogin: true }, null);
        expect(after.surfaces[0].note).toBe("throws on open");
    });
});
