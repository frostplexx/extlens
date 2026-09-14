/**
 * The corpus table — the reason the web UI exists.
 *
 * Every column is visible at once and sortable from its header, which a terminal list cannot do.
 * Rows stay keyboard-reachable (j/k/enter) so a review pass does not require the mouse, and the
 * selected row scrolls itself into view when the keyboard moves it.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import type { ExtensionLight, SortOrder } from "@extlens/protocol";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronsUpDown, FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScoreBar } from "./shared";
import { cn } from "@/lib/utils";

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

    const scoreSort = sort === "interestingness_desc" || sort === "interestingness_asc";

    return (
        <div className={cn("min-h-0 flex-1 overflow-auto transition-opacity", loading && "opacity-50")}>
            <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="hover:bg-transparent">
                        <SortableHead
                            active={scoreSort}
                            direction={sort === "interestingness_desc" ? "desc" : "asc"}
                            onClick={() => onSort(sort === "interestingness_desc" ? "interestingness_asc" : "interestingness_desc")}
                            className="w-36"
                        >
                            Score
                        </SortableHead>
                        <SortableHead active={sort === "name"} direction="asc" onClick={() => onSort("name")}>
                            Name
                        </SortableHead>
                        <TableHead className="w-20">Version</TableHead>
                        <TableHead className="w-20">Manifest</TableHead>
                        <TableHead className="w-80">Tags</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => {
                        const selected = row.id === selectedId;
                        return (
                            <TableRow
                                key={row.id}
                                ref={selected ? selectedRef : undefined}
                                onClick={() => onSelect(row.id)}
                                data-state={selected ? "selected" : undefined}
                                className="cursor-pointer"
                            >
                                <TableCell>
                                    <ScoreBar score={row.score} />
                                </TableCell>
                                <TableCell className="max-w-0 truncate font-medium" title={row.name}>
                                    {row.name}
                                </TableCell>
                                <TableCell className="tabular-nums text-muted-foreground">{row.version ?? "—"}</TableCell>
                                <TableCell>
                                    <Badge variant={row.manifestVersion === 3 ? "default" : "secondary"}>
                                        MV{row.manifestVersion}
                                    </Badge>
                                </TableCell>
                                <TableCell className="overflow-hidden">
                                    <TagList tags={row.tags} />
                                </TableCell>
                                <TableCell>
                                    <StatusIcons hasReport={row.hasReport} hasMv3={row.hasMv3} />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

function SortableHead({
    children,
    active,
    direction,
    onClick,
    className,
}: {
    children: React.ReactNode;
    active: boolean;
    direction: "asc" | "desc";
    onClick: () => void;
    className?: string;
}) {
    const Icon = !active ? ChevronsUpDown : direction === "desc" ? ArrowDown : ArrowUp;
    return (
        <TableHead className={className}>
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    "-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
                    active && "text-foreground",
                )}
            >
                {children}
                <Icon className="size-3" />
            </button>
        </TableHead>
    );
}

const VISIBLE_TAGS = 2;

function prettyTag(tag: string): string {
    // SHOUTING_SNAKE_CASE is the analyzer's internal identifier, not a label for a reader.
    return tag.toLowerCase().replace(/_/g, " ");
}

/**
 * Tags are the analyzer's vocabulary (HAS_BROWSER_POPUP, USES_WEB_REQUEST).
 *
 * Two badges, then a count. Fitting "as many as happen to fit" clipped the last badge mid-word,
 * which reads as a rendering fault rather than as truncation — and the clipped badge hid the
 * overflow counter that was supposed to explain it. A fixed number plus an exact remainder is
 * honest at every column width.
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

function StatusIcons({ hasReport, hasMv3 }: { hasReport: boolean; hasMv3: boolean }) {
    return (
        <div className="flex items-center gap-1.5">
            {hasReport ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <CheckCircle2 className="size-4 text-green" />
                    </TooltipTrigger>
                    <TooltipContent>a report has been recorded</TooltipContent>
                </Tooltip>
            ) : null}
            {hasMv3 && !hasReport ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <FileUp className="size-4 text-blue" />
                    </TooltipTrigger>
                    <TooltipContent>an MV3 migration exists, not yet reviewed</TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
}
