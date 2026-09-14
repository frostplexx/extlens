/** Search, sort and corpus statistics: the controls that act on the table below it. */
import * as React from "react";
import type { ListStats, SortOrder } from "@extlens/protocol";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SORTS } from "../hooks/useExtensions";
import { Stat } from "./shared";

export function Toolbar({
    search,
    onSearch,
    sort,
    onSort,
    stats,
    searchRef,
}: {
    search: string;
    onSearch: (value: string) => void;
    sort: SortOrder;
    onSort: (value: SortOrder) => void;
    stats: ListStats | null;
    searchRef: React.Ref<HTMLInputElement>;
}) {
    return (
        <div className="flex h-16 shrink-0 items-center gap-4 border-b px-5">
            <div className="relative w-80">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder="Search extensions…"
                    className="pl-8"
                />
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                    /
                </kbd>
            </div>

            <Select value={sort} onValueChange={(value) => onSort(value as SortOrder)}>
                <SelectTrigger className="w-44">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {SORTS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                            {s.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {stats ? (
                <>
                    <Separator orientation="vertical" className="h-8" />
                    <div className="flex items-center gap-6">
                        <Stat label="Extensions" value={stats.total} />
                        <Stat label="Analyzed" value={stats.analyzed} />
                        <Stat label="With MV3" value={stats.withMv3} />
                        <Stat label="Avg score" value={stats.avgScore.toFixed(1)} />
                    </div>
                </>
            ) : null}
        </div>
    );
}
