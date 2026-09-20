/**
 * Code mode: the extension as files, with the MV2→MV3 diff where there is one.
 *
 * The profile tells a reviewer what the analyzer found; this shows the thing it found it in. It is
 * a whole mode rather than a tab because a side-by-side diff needs the width, and because reading
 * code is a different activity from filling in a report — you go and come back.
 */
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { ExtensionProfile, FileRefs } from "@extlens/protocol";
import { ArrowLeft, FileQuestion, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { BridgeHandle } from "../hooks/useBridge";
import { useSourceFile, useSourceTree } from "../hooks/useSource";
import type { BrowserLabel, SourceEntry, SourceStatus } from "../types";
import { CodeEditor, type CodeViewMode, type JumpTarget } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { Mono } from "./shared";

/** What the rest of the app asked the code view to show. */
export interface CodeTarget {
    path: string;
    line: number | null;
    /** Bumped on every request, so asking for the same line twice reveals it twice. */
    nonce: number;
}

const STATUS_BADGE: Record<SourceStatus, { label: string; className: string } | null> = {
    unchanged: null,
    added: { label: "added in MV3", className: "text-green" },
    removed: { label: "removed in MV3", className: "text-red" },
    modified: { label: "modified", className: "text-yellow" },
};

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function CodeView({
    bridge,
    profile,
    files,
    subjectId,
    target,
    onExit,
}: {
    bridge: BridgeHandle;
    profile: ExtensionProfile | null;
    files: FileRefs | null;
    subjectId: string | null;
    target: CodeTarget | null;
    onExit: () => void;
}) {
    const source = useSourceTree(bridge, files, subjectId, true);
    const tree = source.loadedId === subjectId ? source.tree : null;
    const hasVariants = Boolean(files?.mv2 && files?.mv3);

    const byPath = useMemo(() => new Map((tree?.entries ?? []).map((e) => [e.path, e])), [tree]);

    /*
     * Which file: the one asked for if it exists, else the manifest — every extension has one and
     * it is where reading an extension starts. Re-derived when the target changes so a listener
     * click lands even while another file is open.
     */
    const [selected, setSelected] = useState<string | null>(null);
    useEffect(() => {
        if (!tree) return;
        const wanted = target?.path && byPath.has(target.path) ? target.path : null;
        setSelected(wanted ?? (byPath.has("manifest.json") ? "manifest.json" : (tree.entries[0]?.path ?? null)));
    }, [tree, byPath, target]);

    const entry: SourceEntry | null = selected ? (byPath.get(selected) ?? null) : null;

    /*
     * Which view: an explicit choice sticks while it still applies to the file; otherwise the file
     * decides — a changed file opens as its diff, a one-sided file as the side it is on.
     */
    const [chosen, setChosen] = useState<CodeViewMode | null>(null);
    const allowed = useMemo<Set<CodeViewMode>>(() => {
        const set = new Set<CodeViewMode>();
        if (!entry) return set;
        if (entry.size.mv2 !== undefined) set.add("mv2");
        if (entry.size.mv3 !== undefined) set.add("mv3");
        if (hasVariants && entry.status !== "unchanged") set.add("diff");
        return set;
    }, [entry, hasVariants]);
    const mode: CodeViewMode | null = !entry
        ? null
        : chosen && allowed.has(chosen)
          ? chosen
          : entry.status === "modified"
            ? "diff"
            : entry.size.mv3 !== undefined
              ? "mv3"
              : "mv2";

    const needMv2 = mode === "mv2" || mode === "diff";
    const needMv3 = mode === "mv3" || mode === "diff";
    const mv2 = useSourceFile(bridge, files, subjectId, needMv2 && entry?.size.mv2 !== undefined ? "mv2" : null, selected);
    const mv3 = useSourceFile(bridge, files, subjectId, needMv3 && entry?.size.mv3 !== undefined ? "mv3" : null, selected);

    // A jump resets the view choice: the line was counted in the analyzed variant, and the file's
    // own default (the diff, for a changed file) is the one that shows that side.
    useEffect(() => setChosen(null), [target]);

    /*
     * The jump belongs to the file it named; opening another file must not drag the cursor along.
     * Its line number is the analyzer's, which read the variant the profile is for.
     */
    const analyzed: BrowserLabel = profile?.manifestVersion === 2 && files?.mv2 ? "mv2" : files?.mv3 ? "mv3" : "mv2";
    const jump: JumpTarget | null =
        target?.line && selected === target.path ? { line: target.line, label: analyzed, nonce: target.nonce } : null;

    const counts = useMemo(() => {
        const c = { added: 0, removed: 0, modified: 0 };
        for (const e of tree?.entries ?? []) if (e.status !== "unchanged") c[e.status] += 1;
        return c;
    }, [tree]);

    if (!profile || !files || !subjectId) {
        return (
            <Empty className="flex-1">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileQuestion />
                    </EmptyMedia>
                    <EmptyTitle>No extension to show</EmptyTitle>
                    <EmptyDescription>Pick one in Browse first; Code mode shows whatever is selected there.</EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={onExit}>
                    <ArrowLeft className="size-4" />
                    Back
                </Button>
            </Empty>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 lg:px-5">
                <Button variant="ghost" size="sm" onClick={onExit}>
                    <ArrowLeft className="size-4" />
                    <span className="hidden sm:inline">Back</span>
                    <Kbd className="hidden lg:inline-flex">Esc</Kbd>
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <h2 className="min-w-0 truncate text-sm font-semibold" title={profile.name}>
                    {profile.name}
                </h2>
                <Badge variant={profile.manifestVersion === 3 ? "default" : "secondary"} className="shrink-0">
                    MV{profile.manifestVersion}
                </Badge>
                {hasVariants && tree ? (
                    <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                        <span className="text-yellow">{counts.modified} modified</span> ·{" "}
                        <span className="text-green">{counts.added} added</span> ·{" "}
                        <span className="text-red">{counts.removed} removed</span>
                    </span>
                ) : null}

                {/* Same segmented control as the TopBar's mode switch, so it reads as a toggle. */}
                <div className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-secondary/60 p-0.5">
                    {(["diff", "mv2", "mv3"] as const).map((m) => (
                        <Button
                            key={m}
                            size="sm"
                            variant={mode === m ? "secondary" : "ghost"}
                            className={cn("h-7 px-2 text-xs", mode === m && "bg-background shadow-sm")}
                            disabled={!allowed.has(m)}
                            onClick={() => setChosen(m)}
                        >
                            {m === "diff" ? "Diff" : m.toUpperCase()}
                        </Button>
                    ))}
                </div>
            </div>

            {source.error ? (
                <Empty className="flex-1">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <TriangleAlert />
                        </EmptyMedia>
                        <EmptyTitle>Could not read the extension</EmptyTitle>
                        <EmptyDescription>{source.error}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : !tree ? (
                <div className="flex flex-1 items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                </div>
            ) : (
                <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
                    <ResizablePanel defaultSize={24} minSize={15}>
                        <aside className="h-full bg-card/40">
                            <FileTree entries={tree.entries} selected={selected} onSelect={setSelected} hasVariants={hasVariants} />
                        </aside>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize={76} minSize={40}>
                        <div className="flex h-full min-h-0 flex-col">
                            {entry ? (
                                <>
                                    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card/40 px-3 text-xs">
                                        <Mono className="truncate">{entry.path}</Mono>
                                        {STATUS_BADGE[entry.status] ? (
                                            <span className={cn("shrink-0", STATUS_BADGE[entry.status]!.className)}>
                                                {STATUS_BADGE[entry.status]!.label}
                                            </span>
                                        ) : null}
                                        <span className="ml-auto shrink-0 text-muted-foreground">
                                            {formatBytes(entry.size.mv3 ?? entry.size.mv2 ?? 0)}
                                        </span>
                                        {mv2.file?.truncated || mv3.file?.truncated ? (
                                            <span className="shrink-0 text-peach">showing the first 2 MB</span>
                                        ) : null}
                                        {tree.truncated ? (
                                            <span className="shrink-0 text-peach">tree truncated</span>
                                        ) : null}
                                    </div>
                                    <div className="relative min-h-0 flex-1">
                                        {entry.binary ? (
                                            <Empty className="h-full">
                                                <EmptyHeader>
                                                    <EmptyTitle>Binary file</EmptyTitle>
                                                    <EmptyDescription>
                                                        {formatBytes(entry.size.mv3 ?? entry.size.mv2 ?? 0)} — nothing to read here.
                                                    </EmptyDescription>
                                                </EmptyHeader>
                                            </Empty>
                                        ) : mv2.error || mv3.error ? (
                                            <Empty className="h-full">
                                                <EmptyHeader>
                                                    <EmptyMedia variant="icon">
                                                        <TriangleAlert />
                                                    </EmptyMedia>
                                                    <EmptyTitle>Could not read this file</EmptyTitle>
                                                    <EmptyDescription>{mv2.error ?? mv3.error}</EmptyDescription>
                                                </EmptyHeader>
                                            </Empty>
                                        ) : mode ? (
                                            <>
                                                {mv2.loading || mv3.loading ? (
                                                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                                                        <Spinner className="size-5 text-muted-foreground" />
                                                    </div>
                                                ) : null}
                                                <CodeEditor
                                                    mode={mode}
                                                    path={entry.path}
                                                    original={needMv2 ? (mv2.file?.content ?? null) : null}
                                                    modified={needMv3 ? (mv3.file?.content ?? null) : null}
                                                    jump={jump}
                                                />
                                            </>
                                        ) : null}
                                    </div>
                                </>
                            ) : (
                                <Empty className="h-full">
                                    <EmptyHeader>
                                        <EmptyTitle>Pick a file</EmptyTitle>
                                    </EmptyHeader>
                                </Empty>
                            )}
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            )}
        </div>
    );
}

export default CodeView;
