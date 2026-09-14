/**
 * The review queue decides what a reviewer is shown and in what order, so the properties worth
 * pinning are the ones that would silently corrupt a pass: never show the same extension twice,
 * and never let an extension reviewed mid-pass disappear from under the cursor.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionLight } from "@extlens/protocol";
import { appendPage, matchesFilter, QUEUE_FILTERS } from "../src/hooks/useReviewQueue";

function ext(id: string, over: Partial<ExtensionLight> = {}): ExtensionLight {
    return {
        id,
        name: `ext-${id}`,
        version: "1.0.0",
        manifestVersion: 2,
        score: 50,
        tags: [],
        hasMv3: false,
        hasReport: false,
        ...over,
    };
}

describe("queue filters", () => {
    it("queues only unreviewed extensions by default", () => {
        expect(matchesFilter("untested", ext("a"))).toBe(true);
        expect(matchesFilter("untested", ext("a", { hasReport: true }))).toBe(false);
    });

    it("queues migrated-but-unreviewed extensions for the mv3 pass", () => {
        expect(matchesFilter("mv3", ext("a", { hasMv3: true }))).toBe(true);
        // Already reviewed, or not migrated at all: neither is work for this pass.
        expect(matchesFilter("mv3", ext("a", { hasMv3: true, hasReport: true }))).toBe(false);
        expect(matchesFilter("mv3", ext("a", { hasMv3: false }))).toBe(false);
    });

    it("queues everything when asked, reviewed or not", () => {
        expect(matchesFilter("all", ext("a", { hasReport: true }))).toBe(true);
        expect(matchesFilter("all", ext("a"))).toBe(true);
    });

    it("offers a filter for each supported value", () => {
        expect(QUEUE_FILTERS.map((f) => f.value)).toEqual(["untested", "mv3", "all"]);
    });
});

describe("appending a page", () => {
    it("filters incoming rows on the way in", () => {
        const queued = appendPage([], [ext("a"), ext("b", { hasReport: true }), ext("c")], "untested");
        expect(queued.map((r) => r.id)).toEqual(["a", "c"]);
    });

    it("never queues the same extension twice", () => {
        // Pages can overlap when the host's ordering shifts between calls; a duplicate would make
        // the reviewer judge the same extension a second time without knowing.
        const first = appendPage([], [ext("a"), ext("b")], "untested");
        const second = appendPage(first, [ext("b"), ext("c")], "untested");
        expect(second.map((r) => r.id)).toEqual(["a", "b", "c"]);
    });

    it("keeps rows already queued even once they have been reviewed", () => {
        // The queue is a snapshot: re-evaluating "untested" against live data on every save would
        // delete the current row out from under the cursor the moment it was filed.
        const first = appendPage([], [ext("a"), ext("b")], "untested");
        const afterReview = appendPage(first, [ext("c")], "untested");
        expect(afterReview.map((r) => r.id)).toEqual(["a", "b", "c"]);
        expect(afterReview[0]).toBe(first[0]);
    });

    it("preserves order across pages", () => {
        const queued = appendPage(appendPage([], [ext("a"), ext("b")], "all"), [ext("c"), ext("d")], "all");
        expect(queued.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    });
});
