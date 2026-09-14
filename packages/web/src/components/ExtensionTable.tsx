/**
 * The corpus table.
 *
 * This is the reason the web UI exists: a dense, sortable, scrollable grid with every column
 * visible at once, which a terminal list cannot be. Rows stay keyboard-navigable (j/k/enter) so
 * the review loop does not require the mouse.
 */
import React, { useEffect, useRef } from "react";
import type { ExtensionLight, SortOrder } from "@extlens/protocol";
import { Pill, ScoreBar } from "./primitives.js";
import { SORTS } from "../hooks/useExtensions.js";

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
    const selectedRef = useRef<HTMLTableRowElement | null>(null);

    // Keyboard selection must keep the row on screen; the pointer already does.
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: "nearest" });
    }, [selectedId]);

    const sortToggle = (column: "score" | "name") => {
        if (column === "name") {
            onSort("name");
            return;
        }
        onSort(sort === "interestingness_desc" ? "interestingness_asc" : "interestingness_desc");
    };

    const arrow = (column: "score" | "name") => {
        if (column === "name") return sort === "name" ? " ↓" : "";
        if (sort === "interestingness_desc") return " ↓";
        if (sort === "interestingness_asc") return " ↑";
        return "";
    };

    return (
        <div className={`h-full overflow-auto ${loading ? "opacity-60" : ""}`}>
            <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-mantle text-[11px] uppercase tracking-wider text-subtext0">
                    <tr>
                        <Th onClick={() => sortToggle("score")} className="w-40">
                            score{arrow("score")}
                        </Th>
                        <Th onClick={() => sortToggle("name")}>name{arrow("name")}</Th>
                        <Th className="w-20">ver</Th>
                        <Th className="w-24">mv</Th>
                        <Th className="w-64">tags</Th>
                        <Th className="w-32">state</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const selected = row.id === selectedId;
                        return (
                            <tr
                                key={row.id}
                                ref={selected ? selectedRef : null}
                                onClick={() => onSelect(row.id)}
                                className={`cursor-pointer border-b border-surface0/50 transition-colors ${
                                    selected ? "bg-surface1/60" : "hover:bg-surface0/50"
                                }`}
                            >
                                <Td>
                                    <ScoreBar score={row.score} />
                                </Td>
                                <Td className="truncate font-medium text-text" title={row.name}>
                                    {row.name}
                                </Td>
                                <Td className="text-subtext0 tabular-nums">{row.version ?? "—"}</Td>
                                <Td>
                                    <Pill tone={row.manifestVersion === 3 ? "info" : "neutral"}>
                                        mv{row.manifestVersion}
                                    </Pill>
                                </Td>
                                <Td className="truncate text-subtext0" title={row.tags.join(", ")}>
                                    {row.tags.length === 0 ? "—" : row.tags.slice(0, 3).join(" · ")}
                                    {row.tags.length > 3 ? ` +${row.tags.length - 3}` : ""}
                                </Td>
                                <Td>
                                    <div className="flex gap-1">
                                        {row.hasReport ? (
                                            <Pill tone="good" title="a report has been recorded">
                                                ✓ tested
                                            </Pill>
                                        ) : null}
                                        {row.hasMv3 && !row.hasReport ? (
                                            <Pill tone="info" title="an MV3 migration exists, not yet reviewed">
                                                ↑ mv3
                                            </Pill>
                                        ) : null}
                                    </div>
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function Th({
    children,
    className = "",
    onClick,
}: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
}) {
    return (
        <th
            onClick={onClick}
            className={`border-b border-surface1 px-3 py-2 font-medium ${onClick ? "cursor-pointer select-none hover:text-text" : ""} ${className}`}
        >
            {children}
        </th>
    );
}

function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
    return (
        <td title={title} className={`max-w-0 px-3 py-1.5 align-middle ${className}`}>
            {children}
        </td>
    );
}
