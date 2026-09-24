/**
 * A filter is only useful if it is exact: the point of narrowing a corpus is to be able to say
 * "these forty are the ones that broke", and a rule that quietly includes an unreviewed row, or
 * drops a row for a facet nobody set, makes that sentence false. The cases below are the ones
 * where a careless implementation would do exactly that.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionVerdict, ListFilter } from "../src/index.js";
import {
    ListFilterSchema,
    ListParamsSchema,
    listFilterCount,
    listFilterIsEmpty,
    matchesListFilter,
} from "../src/index.js";

const row = (over: Partial<{ hasMv3: boolean; hasReport: boolean; verdict: ExtensionVerdict | null }> = {}) => ({
    hasMv3: true,
    hasReport: true,
    verdict: "working" as ExtensionVerdict | null,
    ...over,
});

describe("an empty filter", () => {
    it("treats absent, empty and all-empty-facet filters alike", () => {
        expect(listFilterIsEmpty(undefined)).toBe(true);
        expect(listFilterIsEmpty(null)).toBe(true);
        expect(listFilterIsEmpty({})).toBe(true);
        // An empty array is not a constraint: it is the absence of one, spelled differently.
        expect(listFilterIsEmpty({ verdicts: [], unreviewed: false })).toBe(true);
    });

    it("keeps every row", () => {
        for (const filter of [undefined, {}, { verdicts: [] } as ListFilter]) {
            expect(matchesListFilter(row(), filter)).toBe(true);
            expect(matchesListFilter(row({ hasReport: false, verdict: null }), filter)).toBe(true);
        }
    });
});

describe("the result facet", () => {
    it("keeps the named verdicts and drops the rest", () => {
        const filter: ListFilter = { verdicts: ["not_working", "partially_working"] };
        expect(matchesListFilter(row({ verdict: "not_working" }), filter)).toBe(true);
        expect(matchesListFilter(row({ verdict: "partially_working" }), filter)).toBe(true);
        expect(matchesListFilter(row({ verdict: "working" }), filter)).toBe(false);
        expect(matchesListFilter(row({ verdict: "not_testable" }), filter)).toBe(false);
    });

    it("does not let an unreviewed row in through a verdict selection", () => {
        // The failure this guards: counting "no report" as "not working", which would inflate every
        // failure count by the whole unreviewed remainder of the corpus.
        const filter: ListFilter = { verdicts: ["not_working"] };
        expect(matchesListFilter(row({ hasReport: false, verdict: null }), filter)).toBe(false);
    });

    it("unions unreviewed rows with the selected verdicts rather than intersecting them", () => {
        const filter: ListFilter = { verdicts: ["working"], unreviewed: true };
        expect(matchesListFilter(row({ verdict: "working" }), filter)).toBe(true);
        expect(matchesListFilter(row({ hasReport: false, verdict: null }), filter)).toBe(true);
        expect(matchesListFilter(row({ verdict: "not_working" }), filter)).toBe(false);
    });

    it("asks for unreviewed rows on its own", () => {
        const filter: ListFilter = { unreviewed: true };
        expect(matchesListFilter(row({ hasReport: false, verdict: null }), filter)).toBe(true);
        expect(matchesListFilter(row(), filter)).toBe(false);
    });

    it("excludes a reviewed row whose host recorded no verdict", () => {
        // A host from before the verdict field. It is not unreviewed, and it matches no named
        // verdict — showing it under one nobody recorded would be the worse answer.
        const legacy = row({ hasReport: true, verdict: null });
        expect(matchesListFilter(legacy, { verdicts: ["working"] })).toBe(false);
        expect(matchesListFilter(legacy, { unreviewed: true })).toBe(false);
        expect(matchesListFilter(legacy, {})).toBe(true);
    });
});

describe("the migration facet", () => {
    it("selects either side of it", () => {
        expect(matchesListFilter(row({ hasMv3: true }), { migrated: true })).toBe(true);
        expect(matchesListFilter(row({ hasMv3: false }), { migrated: true })).toBe(false);
        expect(matchesListFilter(row({ hasMv3: false }), { migrated: false })).toBe(true);
        expect(matchesListFilter(row({ hasMv3: true }), { migrated: false })).toBe(false);
    });

    it("intersects with the result facet instead of widening it", () => {
        const filter: ListFilter = { verdicts: ["working"], migrated: true };
        expect(matchesListFilter(row({ verdict: "working", hasMv3: true }), filter)).toBe(true);
        // Matches the verdict, wrong side of the other facet: AND between facets, not OR.
        expect(matchesListFilter(row({ verdict: "working", hasMv3: false }), filter)).toBe(false);
    });
});

describe("counting active facets", () => {
    it("counts facets, not selections", () => {
        expect(listFilterCount(undefined)).toBe(0);
        expect(listFilterCount({})).toBe(0);
        expect(listFilterCount({ verdicts: ["working", "not_working", "not_testable"] })).toBe(1);
        expect(listFilterCount({ unreviewed: true })).toBe(1);
        expect(listFilterCount({ verdicts: ["working"], unreviewed: true })).toBe(1);
        expect(listFilterCount({ verdicts: ["working"], migrated: false })).toBe(2);
    });
});

describe("the schema", () => {
    it("accepts a filter on list params and leaves it absent when unsent", () => {
        expect(ListParamsSchema.parse({}).filter).toBeUndefined();
        const parsed = ListParamsSchema.parse({ filter: { verdicts: ["working"], migrated: true } });
        expect(parsed.filter).toEqual({ verdicts: ["working"], migrated: true });
    });

    it("rejects a verdict it does not define", () => {
        expect(() => ListFilterSchema.parse({ verdicts: ["mostly_fine"] })).toThrow();
        expect(() => ListParamsSchema.parse({ filter: { migrated: "yes" } })).toThrow();
    });
});
