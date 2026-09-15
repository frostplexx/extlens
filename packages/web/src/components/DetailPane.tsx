/**
 * Everything known about the selected extension, and the controls that act on it.
 *
 * Tabs rather than one long scroll: a reviewer is doing one of two things — filling in the report
 * while watching Chrome, or reading the profile to decide what to check — and making the second
 * scroll past the first every time was the main friction of the terminal version.
 *
 * The launch buttons are the interesting part: they call `local.launch` on the bridge, and the
 * node process that served this page spawns Chrome for Testing. The page never touches a process;
 * it asks the thing that served it to.
 */
import * as React from "react";
import type { ExtensionProfile, FileRefs, ManifestSummary, Report, ReportDraft, ScoreBreakdown } from "@extlens/protocol";
import { Download, MonitorPlay, MousePointerSquareDashed, SquareX, TriangleAlert } from "lucide-react";
import { WEIGHTS, type WeightKey } from "@extlens/analyzer/scoring";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LocalSnapshot } from "../types";
import { Mono, PhaseBadge, ScoreBar, prettyTag } from "./shared";
import { ReportForm } from "./ReportForm";

const BREAKDOWN_LABELS: [keyof ScoreBreakdown, string][] = [
    ["webRequest", "webRequest"],
    ["htmlLines", "HTML lines"],
    ["storageLocal", "storage.local"],
    ["backgroundPage", "background page"],
    ["contentScripts", "content scripts"],
    ["dangerousPermissions", "dangerous permissions"],
    ["hostPermissions", "host permissions"],
    ["cryptoPatterns", "crypto patterns"],
    ["networkRequests", "network requests"],
    ["extensionSize", "size (100KB units)"],
    ["apiRenames", "API renames (host)"],
    ["manifestChanges", "manifest changes (host)"],
    ["fileModifications", "file modifications (host)"],
    ["webRequestToDnr", "webRequest → DNR (host)"],
];

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DetailPane({
    profile,
    files,
    report,
    loading,
    error,
    local,
    onLaunch,
    onCloseBrowsers,
    onAnswerPrompt,
    onSubmitReport,
    submitting,
    submitError,
    onOpenUrl,
}: {
    profile: ExtensionProfile | null;
    files: FileRefs | null;
    report: Report | null;
    loading: boolean;
    error: string | null;
    local: LocalSnapshot;
    onLaunch: () => void;
    onCloseBrowsers: () => void;
    onAnswerPrompt: (accept: boolean) => void;
    onSubmitReport: (draft: ReportDraft) => void;
    submitting: boolean;
    submitError: string | null;
    onOpenUrl?: (url: string) => void;
}) {
    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <Empty className="h-full">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <TriangleAlert />
                    </EmptyMedia>
                    <EmptyTitle>Could not load this extension</EmptyTitle>
                    <EmptyDescription>{error}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    if (!profile) {
        return (
            <Empty className="h-full">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <MousePointerSquareDashed />
                    </EmptyMedia>
                    <EmptyTitle>No extension selected</EmptyTitle>
                    <EmptyDescription>
                        Pick a row, or press <Kbd>j</Kbd> / <Kbd>k</Kbd> to move through the list.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="mx-auto w-full max-w-3xl shrink-0 space-y-3 p-5">
                <div className="space-y-1">
                    <h2 className="truncate text-lg font-semibold leading-tight" title={profile.name}>
                        {profile.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>v{profile.version ?? "?"}</span>
                        <Badge variant={profile.manifestVersion === 3 ? "default" : "secondary"}>
                            MV{profile.manifestVersion}
                        </Badge>
                        {profile.hasMv3 ? (
                            <Badge variant="outline" className="text-green">
                                MV3 variant
                            </Badge>
                        ) : null}
                        <span>{formatBytes(profile.sizeBytes)}</span>
                        {report ? (
                            <Badge variant="outline" className="text-green">
                                reviewed
                            </Badge>
                        ) : null}
                    </div>
                </div>
                {profile.manifest.description ? (
                    <p className="text-sm leading-snug text-muted-foreground">{profile.manifest.description}</p>
                ) : null}
                <ScoreBar score={profile.score} className="max-w-56" />
            </header>

            <Separator />

            <BrowserControls
                local={local}
                canLaunch={!!files}
                files={files}
                onLaunch={onLaunch}
                onCloseBrowsers={onCloseBrowsers}
                onAnswerPrompt={onAnswerPrompt}
            />

            <Separator />

            <Tabs defaultValue="report" className="flex min-h-0 flex-1 flex-col gap-0">
                <div className="mx-auto w-full max-w-3xl px-5">
                <TabsList className="mt-4">
                    <TabsTrigger value="report">Report</TabsTrigger>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="manifest">Manifest</TabsTrigger>
                    <TabsTrigger value="listeners">Listeners ({profile.listeners.length})</TabsTrigger>
                </TabsList>
                </div>

                {/* The scroller stays full width so the scrollbar sits at the pane edge; the column
                    inside it is what is centred. */}
                <div className="min-h-0 flex-1 overflow-auto">
                    <div className="mx-auto w-full max-w-3xl p-5">
                    <TabsContent value="report" className="mt-0">
                        <ReportForm
                            profile={profile}
                            saved={report}
                            onSubmit={onSubmitReport}
                            submitting={submitting}
                            error={submitError}
                            onOpenUrl={onOpenUrl}
                        />
                    </TabsContent>

                    <TabsContent value="profile" className="mt-0 space-y-6">
                        {profile.tags.length > 0 ? (
                            <section className="space-y-2">
                                <h3 className="text-sm font-medium">Feature tags</h3>
                                <div className="flex flex-wrap gap-1">
                                    {profile.tags.map((tag) => (
                                        <Badge key={tag} variant="outline" className="font-normal text-muted-foreground">
                                            {prettyTag(tag)}
                                        </Badge>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        <section className="space-y-2">
                            <h3 className="text-sm font-medium">Score breakdown</h3>
                            <Breakdown breakdown={profile.breakdown} />
                        </section>
                    </TabsContent>

                    <TabsContent value="manifest" className="mt-0 space-y-6">
                        <section className="space-y-2">
                            <h3 className="text-sm font-medium">{profile.mv2 ? "MV3" : "Manifest"}</h3>
                            <Manifest manifest={profile.manifest} />
                        </section>
                        {profile.mv2 ? (
                            <section className="space-y-2">
                                <h3 className="text-sm font-medium">MV2</h3>
                                <Manifest manifest={profile.mv2} showName />
                            </section>
                        ) : null}
                    </TabsContent>

                    <TabsContent value="listeners" className="mt-0">
                        {profile.listeners.length === 0 ? (
                            <p className="text-sm text-muted-foreground">None detected.</p>
                        ) : (
                            <ul className="space-y-1">
                                {profile.listeners.map((l) => (
                                    <li key={`${l.api}:${l.file}:${l.line}`} className="truncate">
                                        <Mono>{l.api}</Mono>
                                        <Mono className="text-muted-foreground">
                                            {" "}
                                            {l.file}:{l.line}
                                        </Mono>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </TabsContent>
                    </div>
                </div>
            </Tabs>
        </div>
    );
}

/**
 * Browser controls sit outside the tabs on purpose: launching Chrome is what the reviewer does
 * *before* filling anything in, and burying it under a tab would make the primary action the one
 * thing you have to go looking for.
 */
function BrowserControls({
    local,
    canLaunch,
    files,
    onLaunch,
    onCloseBrowsers,
    onAnswerPrompt,
}: {
    local: LocalSnapshot;
    canLaunch: boolean;
    files: FileRefs | null;
    onLaunch: () => void;
    onCloseBrowsers: () => void;
    onAnswerPrompt: (accept: boolean) => void;
}) {
    const prompt = local.prompts[0];
    const busy = Object.values(local.browsers).some((b) => b.phase === "launching" || b.phase === "downloading");

    return (
        <div className="shrink-0 space-y-3 p-5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Test browsers</h3>
                <div className="flex gap-2">
                    <Button size="sm" onClick={onLaunch} disabled={!canLaunch || busy}>
                        {busy ? <Spinner /> : <MonitorPlay className="size-4" />}
                        Launch
                    </Button>
                    <Button size="sm" variant="secondary" onClick={onCloseBrowsers}>
                        <SquareX className="size-4" />
                        Close
                    </Button>
                </div>
            </div>

            <ItemGroup className="gap-2">
                {(["mv2", "mv3"] as const).map((label) => {
                    const state = local.browsers[label];
                    return (
                        <Item key={label} variant="outline" size="sm">
                            <ItemMedia>
                                <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className="truncate text-xs text-muted-foreground">
                                    {state.message ?? (files?.[label] ? files[label] : "no files for this variant")}
                                </ItemTitle>
                            </ItemContent>
                            <ItemActions>
                                <PhaseBadge phase={state.phase} />
                            </ItemActions>
                        </Item>
                    );
                })}
            </ItemGroup>

            {prompt ? (
                <div className="space-y-2 rounded-md border border-peach/40 bg-peach/10 p-3">
                    <p className="text-sm text-peach">{prompt.message}</p>
                    <p className="text-xs text-muted-foreground">
                        Download Chrome for Testing into <Mono>{local.browserDir}</Mono>?
                    </p>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => onAnswerPrompt(true)}>
                            <Download className="size-4" />
                            Download
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onAnswerPrompt(false)}>
                            Skip
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/**
 * What the score is made of.
 *
 * Was a row of bars scaled to the largest raw count, which compared quantities sharing no unit —
 * HTML lines against crypto patterns against 100KB units — so the longest bar only ever meant
 * "this dimension happens to be counted in small things". The score is a weighted sum, so the
 * number that explains it is count × weight, and the useful ordering is by that contribution.
 */
function Breakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
    const rows = BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0)
        .map(([key, label]) => ({
            key,
            label,
            count: breakdown[key],
            weight: WEIGHTS[key as WeightKey],
            points: breakdown[key] * WEIGHTS[key as WeightKey],
        }))
        .sort((a, b) => b.points - a.points);

    if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing scored.</p>;
    const total = rows.reduce((sum, r) => sum + r.points, 0);

    return (
        <Table>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>Dimension</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="w-16 text-right">Share</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row) => (
                    <TableRow key={row.key} className="hover:bg-transparent">
                        <TableCell className="text-muted-foreground">{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">×{row.weight}</TableCell>
                        <TableCell className="text-right tabular-nums text-blue">
                            {Math.round(row.points).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                            {Math.round((row.points / total) * 100)}%
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
            <TableFooter>
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3}>Score</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                        {Math.round(total).toLocaleString()}
                    </TableCell>
                    <TableCell />
                </TableRow>
            </TableFooter>
        </Table>
    );
}

function Manifest({ manifest, showName = false }: { manifest: ManifestSummary; showName?: boolean }) {
    const background =
        manifest.background === null ? "none" : `${manifest.background.type}(${manifest.background.scripts.join(", ")})`;
    const rows: [string, React.ReactNode][] = [
        ...(showName ? ([["Name", manifest.name]] as [string, React.ReactNode][]) : []),
        ...(manifest.id ? ([["ID", <Mono key="id">{manifest.id}</Mono>]] as [string, React.ReactNode][]) : []),
        ...(manifest.description ? ([["Description", manifest.description]] as [string, React.ReactNode][]) : []),
        ["Background", <Mono key="bg">{background}</Mono>],
        ["Permissions", manifest.permissions.join(", ") || "—"],
        ["Host permissions", manifest.hostPermissions.join(", ") || "—"],
        [
            "Content scripts",
            manifest.contentScripts.length === 0
                ? "—"
                : manifest.contentScripts.map((cs, i) => (
                      <div key={i} className="truncate">
                          <Mono>
                              {cs.matches.join(" | ")} → {cs.js.join(", ")}
                          </Mono>
                      </div>
                  )),
        ],
        ["Popup", manifest.action?.defaultPopup ?? "—"],
        ["Options page", manifest.optionsPage ?? "—"],
        ["New tab override", manifest.chromeUrlOverrides.newtab ?? "—"],
    ];
    return (
        <dl className="divide-y divide-border/60">
            {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                </div>
            ))}
        </dl>
    );
}
