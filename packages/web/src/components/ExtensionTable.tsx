/**
 * The corpus table, built on TanStack Table over the shadcn `table` primitives.
 *
 * Sorting and paging stay server-side — the host owns the corpus and can hold far more rows than
 * a page should fetch — so the table runs in manual mode and only owns presentation. What TanStack
 * buys here is the column model: widths, headers, cells and sort state described once, in one
 * place, instead of being spread across a hand-written <thead>/<tbody> pair that can disagree.
 */
import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import type { ExtensionLight, ExtensionVerdict, SortOrder } from "@extlens/protocol";
import { VERDICT_LABELS } from "@extlens/protocol";
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronsUpDown, CircleAlert, CircleSlash, FileUp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScoreBar, prettyTag } from "./shared";
import { cn } from "@/lib/utils";

const VISIBLE_TAGS = 2;

/** The protocol's sort orders as TanStack sorting state, and back. */
function toSortingState(sort: SortOrder): SortingState {
    if (sort === "name") return [{ id: "name", desc: false }];
    return [{ id: "score", desc: sort === "interestingness_desc" }];
}

function fromSortingState(state: SortingState): SortOrder {
    const first = state[0];
    if (!first || first.id === "name") return "name";
    return first.desc ? "interestingness_desc" : "interestingness_asc";
}

export function ExtensionTable({
    rows,
    selectedId,
    sort,
    onSort,
    onSelect,
    loading,
}: {
    rows: ExtensionLight[];
    selectedId: string | null;
    sort: SortOrder;
    onSort: (sort: SortOrder) => void;
    onSelect: (id: string) => void;
    loading: boolean;
}) {
    const selectedRef = useRef<HTMLTableRowElement>(null);

    // Keyboard selection has to bring its row with it; a pointer click already has.
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: "nearest" });
    }, [selectedId]);

    const columns = useMemo<ColumnDef<ExtensionLight>[]>(
        () => [
            {
                id: "score",
                accessorKey: "score",
                header: "Score",
                size: 80,
                cell: ({ row }) => <ScoreBar score={row.original.score} />,
            },
            {
                id: "name",
                accessorKey: "name",
                header: "Name",
                // Zero width means "the rest": the only column allowed to flex under fixed layout.
                size: 0,
                minSize: 0,
                cell: ({ row }) => (
                    <span className="block truncate font-medium" title={row.original.name}>
                        {row.original.name}
                    </span>
                ),
            },
            {
                id: "tags",
                accessorKey: "tags",
                header: "Tags",
                size: 320,
                enableSorting: false,
                cell: ({ row }) => <TagList tags={row.original.tags} />,
            },
            {
                id: "result",
                header: "Result",
                size: 150,
                enableSorting: false,
                cell: ({ row }) => <Result row={row.original} />,
            },
        ],
        [],
    );

    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualSorting: true,
        manualPagination: true,
        state: { sorting: toSortingState(sort) },
        onSortingChange: (updater) => {
            const next = typeof updater === "function" ? updater(toSortingState(sort)) : updater;
            onSort(fromSortingState(next));
        },
    });

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            {/* Fixed layout: column widths are the ones declared, so the header and every row line up
                regardless of what a cell happens to contain. */}
            <Table className="table-fixed">
                <TableHeader className="sticky top-0 z-10 bg-card">
                    {table.getHeaderGroups().map((group) => (
                        <TableRow key={group.id} className="hover:bg-transparent">
                            {group.headers.map((header) => {
                                const sortable = header.column.getCanSort();
                                const direction = header.column.getIsSorted();
                                const Icon = !direction ? ChevronsUpDown : direction === "desc" ? ArrowDown : ArrowUp;
                                return (
                                    <TableHead key={header.id} style={{ width: header.getSize() || undefined }}>
                                        {sortable ? (
                                            <button
                                                type="button"
                                                onClick={header.column.getToggleSortingHandler()}
                                                className={cn(
                                                    "-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
                                                    direction && "text-foreground",
                                                )}
                                            >
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                <Icon className="size-3" />
                                            </button>
                                        ) : (
                                            flexRender(header.column.columnDef.header, header.getContext())
                                        )}
                                    </TableHead>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {/* Skeleton rows on the first load only. Once there are rows, a refetch keeps
                        them on screen rather than blanking the table under the reader. */}
                    {loading && rows.length === 0
                        ? Array.from({ length: 8 }).map((_, i) => (
                              <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                                  {columns.map((column) => (
                                      <TableCell key={column.id}>
                                          <Skeleton className="h-4 w-full" />
                                      </TableCell>
                                  ))}
                              </TableRow>
                          ))
                        : table.getRowModel().rows.map((row) => {
                              const selected = row.original.id === selectedId;
                              return (
                                  <TableRow
                                      key={row.id}
                                      ref={selected ? selectedRef : undefined}
                                      onClick={() => onSelect(row.original.id)}
                                      data-state={selected ? "selected" : undefined}
                                      className="cursor-pointer"
                                  >
                                      {row.getVisibleCells().map((cell) => (
                                          <TableCell key={cell.id} className="max-w-0 overflow-hidden">
                                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              );
                          })}
                </TableBody>
            </Table>
        </div>
    );
}

/**
 * Two badges, then an exact count.
 *
 * Fitting "as many as happen to fit" clipped the last badge mid-word, which reads as a rendering
 * fault rather than as truncation — and the clipped badge hid the counter that was supposed to
 * explain it. A fixed number plus a remainder is honest at every column width.
 */
function TagList({ tags }: { tags: string[] }) {
    if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
    const shown = tags.slice(0, VISIBLE_TAGS);
    const rest = tags.slice(VISIBLE_TAGS);
    return (
        <div className="flex items-center gap-1">
            {shown.map((tag) => (
                <Badge
                    key={tag}
                    variant="outline"
                    className="max-w-40 shrink-0 truncate font-normal text-muted-foreground"
                    title={prettyTag(tag)}
                >
                    {prettyTag(tag)}
                </Badge>
            ))}
            {rest.length > 0 ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge variant="secondary" className="shrink-0 font-normal">
                            +{rest.length}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{rest.map(prettyTag).join(", ")}</TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
}

/**
 * The one thing a corpus table is scanned for: did the migration hold up?
 *
 * Version and manifest used to sit here and answered nothing a reviewer was asking — every row in
 * a migrated corpus is MV3, and a version string is not something you compare across extensions.
 * The verdict is; and before there is one, the only other state worth a word is "migrated, not yet
 * looked at".
 */
const RESULT_TONE: Record<ExtensionVerdict, string> = {
    working: "text-green",
    partially_working: "text-yellow",
    not_working: "text-red",
    not_testable: "text-blue",
};

const RESULT_ICON: Record<ExtensionVerdict, React.ElementType> = {
    working: CheckCircle2,
    partially_working: CircleAlert,
    not_working: XCircle,
    not_testable: CircleSlash,
};

function Result({ row }: { row: ExtensionLight }) {
    const verdict = row.verdict ?? null;
    if (verdict) {
        const Icon = RESULT_ICON[verdict];
        return (
            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", RESULT_TONE[verdict])}>
                <Icon className="size-4 shrink-0" />
                {VERDICT_LABELS[verdict]}
            </span>
        );
    }
    if (row.hasReport) {
        // A host from before the verdict field: it says there is a report but not what it found.
        return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0" />
                Reviewed
            </span>
        );
    }
    if (row.hasMv3) {
        return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                <FileUp className="size-4 shrink-0" />
                Not reviewed
            </span>
        );
    }
    return <span className="text-muted-foreground">—</span>;
}
