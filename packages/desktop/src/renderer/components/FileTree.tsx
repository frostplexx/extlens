/**
 * The extension's files, the way an editor's sidebar shows them.
 *
 * One tree for both variants: a migration is the same extension twice, and what the reviewer wants
 * to know per file is not "which side is it on" but "did it change". So the union of paths is
 * shown once, with VS Code's git decorations — A, M, D — doing the telling.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, FileJson2, FileText, Folder, FolderOpen, Image, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SourceEntry, SourceStatus } from "../types";

interface Node {
    name: string;
    path: string;
    children: Node[];
    entry: SourceEntry | null;
    /** For a folder: the loudest status among its files, so a collapsed folder still says so. */
    status: SourceStatus;
}

const LOUDNESS: Record<SourceStatus, number> = { unchanged: 0, removed: 1, added: 2, modified: 3 };
const LETTER: Record<SourceStatus, string> = { unchanged: "", added: "A", removed: "D", modified: "M" };
const STATUS_CLASS: Record<SourceStatus, string> = {
    unchanged: "",
    added: "text-green",
    removed: "text-red",
    modified: "text-yellow",
};

function build(entries: SourceEntry[]): Node {
    const root: Node = { name: "", path: "", children: [], entry: null, status: "unchanged" };
    for (const entry of entries) {
        const parts = entry.path.split("/");
        let node = root;
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i]!;
            const path = parts.slice(0, i + 1).join("/");
            let next = node.children.find((c) => c.name === name);
            if (!next) {
                next = { name, path, children: [], entry: null, status: "unchanged" };
                node.children.push(next);
            }
            if (i === parts.length - 1) next.entry = entry;
            node = next;
        }
    }
    const finish = (node: Node): SourceStatus => {
        if (node.entry) return (node.status = node.entry.status);
        // Folders first, then files, each alphabetical — the order every editor uses.
        node.children.sort((a, b) => {
            const folderA = a.entry === null ? 0 : 1;
            const folderB = b.entry === null ? 0 : 1;
            return folderA - folderB || a.name.localeCompare(b.name);
        });
        let loudest: SourceStatus = "unchanged";
        for (const child of node.children) {
            const s = finish(child);
            if (LOUDNESS[s] > LOUDNESS[loudest]) loudest = s;
        }
        return (node.status = loudest);
    };
    finish(root);
    return root;
}

function FileIcon({ path, className }: { path: string; className?: string }) {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "json") return <FileJson2 className={className} />;
    if (["js", "mjs", "cjs", "ts", "html", "htm", "css"].includes(ext)) return <FileCode2 className={className} />;
    if (["png", "jpg", "jpeg", "gif", "webp", "ico", "svg"].includes(ext)) return <Image className={className} />;
    return <FileText className={className} />;
}

export function FileTree({
    entries,
    selected,
    onSelect,
    hasVariants,
}: {
    entries: SourceEntry[];
    selected: string | null;
    onSelect: (path: string) => void;
    /** Both MV2 and MV3 exist, so statuses mean something and "changed only" is worth offering. */
    hasVariants: boolean;
}) {
    const [filter, setFilter] = useState("");
    const [changedOnly, setChangedOnly] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const listRef = useRef<HTMLDivElement>(null);

    // A new extension is a new tree: filters and folds from the last one mean nothing here.
    useEffect(() => {
        setFilter("");
        setChangedOnly(false);
        setCollapsed(new Set());
    }, [entries]);

    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        return entries.filter(
            (e) => (!changedOnly || e.status !== "unchanged") && (!needle || e.path.toLowerCase().includes(needle)),
        );
    }, [entries, filter, changedOnly]);
    const root = useMemo(() => build(visible), [visible]);
    // While filtering, every folder is open: a match hidden behind a fold is a match not found.
    const filtering = filter.trim().length > 0 || changedOnly;

    /** The rows as rendered, in order, for keyboard movement. */
    const rows = useMemo(() => {
        const out: { node: Node; depth: number }[] = [];
        const walk = (node: Node, depth: number) => {
            for (const child of node.children) {
                out.push({ node: child, depth });
                if (child.entry === null && (filtering || !collapsed.has(child.path))) walk(child, depth + 1);
            }
        };
        walk(root, 0);
        return out;
    }, [root, collapsed, filtering]);

    const toggle = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const [cursor, setCursor] = useState<string | null>(null);
    useEffect(() => setCursor(selected), [selected]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const index = rows.findIndex((r) => r.node.path === cursor);
        const current = index >= 0 ? rows[index]!.node : null;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
            if (next) setCursor(next.node.path);
        } else if (e.key === "Enter" && current) {
            e.preventDefault();
            if (current.entry) onSelect(current.path);
            else toggle(current.path);
        } else if (e.key === "ArrowRight" && current && !current.entry && collapsed.has(current.path)) {
            e.preventDefault();
            toggle(current.path);
        } else if (e.key === "ArrowLeft" && current) {
            e.preventDefault();
            if (!current.entry && !collapsed.has(current.path)) toggle(current.path);
            else {
                const parent = current.path.includes("/") ? current.path.slice(0, current.path.lastIndexOf("/")) : null;
                if (parent) setCursor(parent);
            }
        }
    };

    // Keep the keyboard cursor on screen as it moves.
    useEffect(() => {
        if (!cursor) return;
        listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const changed = entries.filter((e) => e.status !== "unchanged").length;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 space-y-2 border-b p-2">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter files"
                        className="h-7 pl-7 text-xs md:text-xs"
                        data-tree-filter
                    />
                </div>
                {hasVariants ? (
                    <div className="flex items-center gap-2">
                        <Switch id="changed-only" checked={changedOnly} onCheckedChange={setChangedOnly} className="scale-90" />
                        <Label htmlFor="changed-only" className="cursor-pointer text-xs font-normal text-muted-foreground">
                            Changed only ({changed})
                        </Label>
                    </div>
                ) : null}
            </div>

            <div
                ref={listRef}
                className="min-h-0 flex-1 overflow-auto py-1 text-[13px] outline-none"
                tabIndex={0}
                role="tree"
                onKeyDown={onKeyDown}
            >
                {rows.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No files match.</p>
                ) : (
                    rows.map(({ node, depth }) => {
                        const isFolder = node.entry === null;
                        const open = filtering || !collapsed.has(node.path);
                        const isSelected = !isFolder && node.path === selected;
                        const isCursor = node.path === cursor;
                        return (
                            <div
                                key={node.path}
                                data-path={node.path}
                                role="treeitem"
                                aria-selected={isSelected}
                                className={cn(
                                    "flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap py-0.5 pr-2 hover:bg-accent/50",
                                    isSelected && "bg-accent text-accent-foreground",
                                    isCursor && !isSelected && "bg-accent/30",
                                )}
                                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                                onClick={() => {
                                    setCursor(node.path);
                                    if (isFolder) toggle(node.path);
                                    else onSelect(node.path);
                                }}
                            >
                                {isFolder ? (
                                    open ? (
                                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                                    )
                                ) : (
                                    <span className="size-3.5 shrink-0" />
                                )}
                                {isFolder ? (
                                    open ? (
                                        <FolderOpen className="size-3.5 shrink-0 text-blue" />
                                    ) : (
                                        <Folder className="size-3.5 shrink-0 text-blue" />
                                    )
                                ) : (
                                    <FileIcon path={node.path} className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span
                                    className={cn(
                                        "min-w-0 truncate",
                                        STATUS_CLASS[node.status],
                                        node.status === "removed" && !isFolder && "line-through",
                                    )}
                                    title={node.path}
                                >
                                    {node.name}
                                </span>
                                {node.status !== "unchanged" ? (
                                    isFolder ? (
                                        <span className={cn("ml-auto size-1.5 shrink-0 rounded-full bg-current", STATUS_CLASS[node.status])} />
                                    ) : (
                                        <span className={cn("ml-auto shrink-0 text-[11px] font-medium", STATUS_CLASS[node.status])}>
                                            {LETTER[node.status]}
                                        </span>
                                    )
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
