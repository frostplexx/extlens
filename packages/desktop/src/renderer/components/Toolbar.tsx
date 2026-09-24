/** Search, sort, filter and corpus statistics: the controls that act on the table below them. */
import * as React from "react";
import type { ListFilter, ListStats, SortOrder } from "@extlens/protocol";
import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FilterMenu } from "./FilterMenu";
import { SORTS } from "../hooks/useExtensions";
import { Stat } from "./shared";

export function Toolbar({
    search,
    onSearch,
    sort,
    onSort,
    filter,
    onFilter,
    stats,
    searchRef,
}: {
    search: string;
    onSearch: (value: string) => void;
    sort: SortOrder;
    onSort: (value: SortOrder) => void;
    filter: ListFilter;
    onFilter: (value: ListFilter) => void;
    stats: ListStats | null;
    searchRef: React.Ref<HTMLInputElement>;
}) {
    return (
        <div className="flex h-16 shrink-0 items-center gap-4 border-b px-5">
            <InputGroup className="w-80">
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    ref={searchRef}
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder="Search extensions…"
                />
                <InputGroupAddon align="inline-end">
                    <Kbd>/</Kbd>
                </InputGroupAddon>
            </InputGroup>

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

            <FilterMenu filter={filter} onChange={onFilter} />

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
