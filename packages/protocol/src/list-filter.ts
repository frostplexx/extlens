/**
 * Applying a list filter, and describing one.
 *
 * This lives in the protocol for the same reason the verdict rules do: a filter is only meaningful
 * if "working" selects the same rows whichever host answered the call. There are two hosts today
 * (a SQLite folder backend and AgenticMigrator's run directory) plus the client's own empty-state
 * copy, and each would otherwise be free to decide whether an unreviewed row counts as
 * "not working" — which would make a filtered corpus count not comparable to anything.
 */
import type { ExtensionLight, ExtensionVerdict, ListFilter } from "./types.js";

/** The parts of a row a filter reads. A host can pass a full `ExtensionLight`. */
export type FilterableRow = Pick<ExtensionLight, "hasMv3" | "hasReport"> & {
  verdict?: ExtensionVerdict | null;
};

/** Does this filter constrain anything? `{}`, and a filter of empty facets, do not. */
export function listFilterIsEmpty(filter: ListFilter | null | undefined): boolean {
  if (!filter) return true;
  return (
    (filter.verdicts?.length ?? 0) === 0 && !filter.unreviewed && filter.migrated === undefined
  );
}

/**
 * How many facets are constraining, for a UI that shows the count on a collapsed control.
 *
 * Facets, not selections: a reader who ticked three verdicts has narrowed the result once, and a
 * badge reading "3" for that would suggest three independent constraints they have to go and find.
 */
export function listFilterCount(filter: ListFilter | null | undefined): number {
  if (!filter) return 0;
  const result = (filter.verdicts?.length ?? 0) > 0 || filter.unreviewed === true;
  return (result ? 1 : 0) + (filter.migrated === undefined ? 0 : 1);
}

/**
 * Keep this row?
 *
 * A row whose host reports `hasReport` but no verdict — a host from before the field existed — is
 * kept only by `unreviewed: false`-style facets it actually satisfies: it is not unreviewed, and
 * it matches no named verdict, so selecting verdicts drops it. That is the honest answer; the
 * alternative is showing a row under a verdict nobody recorded.
 */
export function matchesListFilter(
  row: FilterableRow,
  filter: ListFilter | null | undefined,
): boolean {
  if (listFilterIsEmpty(filter) || !filter) return true;

  const verdicts = filter.verdicts ?? [];
  if (verdicts.length > 0 || filter.unreviewed) {
    const byVerdict = row.verdict != null && verdicts.includes(row.verdict);
    const byUnreviewed = filter.unreviewed === true && !row.hasReport;
    if (!byVerdict && !byUnreviewed) return false;
  }

  if (filter.migrated !== undefined && row.hasMv3 !== filter.migrated) return false;

  return true;
}
