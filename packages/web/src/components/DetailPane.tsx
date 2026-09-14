/**
 * Everything known about the selected extension, and the controls that act on it.
 *
 * The launch buttons are the interesting part: they call `local.launch` on the bridge, and the
 * node process that served this page spawns Chrome for Testing. The page never touches a process;
 * it asks the thing that served it to.
 */
import * as React from "react";
import type { ExtensionProfile, FileRefs, ManifestSummary, Report, ReportDraft, ScoreBreakdown } from "@extlens/protocol";
import { Download, Loader2, MonitorPlay, SquareX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { LocalSnapshot } from "../types";
import { EmptyState, Field, Mono, PhaseBadge, ScoreBar } from "./shared";
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
}) {
    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (error) return <EmptyState title="Could not load this extension" hint={error} />;
    if (!profile) {
        return <EmptyState title="No extension selected" hint="Pick a row, or press j / k to move through the list." />;
    }

    const prompt = local.prompts[0];
    const launching = Object.values(local.browsers).some((b) => b.phase === "launching" || b.phase === "downloading");

    return (
        <div className="flex h-full flex-col overflow-auto">
            <header className="space-y-3 p-5">
                <div className="space-y-1">
                    <h2 className="truncate text-lg font-semibold leading-tight" title={profile.name}>
                        {profile.name}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>v{profile.version ?? "?"}</span>
                        <Badge variant={profile.manifestVersion === 3 ? "default" : "secondary"}>
                            MV{profile.manifestVersion}
                        </Badge>
                        {profile.hasMv3 ? <Badge variant="outline" className="text-green">MV3 variant</Badge> : null}
                        <span>{formatBytes(profile.sizeBytes)}</span>
                    </div>
                </div>
                <ScoreBar score={profile.score} className="max-w-56" />
                {profile.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {profile.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="font-normal text-muted-foreground">
                                {tag.toLowerCase().replace(/_/g, " ")}
                            </Badge>
                        ))}
                    </div>
                ) : null}
            </header>

            <Separator />

            <div className="space-y-4 p-5">
                <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-sm">Test browsers</CardTitle>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={onLaunch} disabled={!files || launching}>
                                {launching ? <Loader2 className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />}
                                Launch
                            </Button>
                            <Button size="sm" variant="secondary" onClick={onCloseBrowsers}>
                                <SquareX className="size-4" />
                                Close
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {(["mv2", "mv3"] as const).map((label) => {
                            const state = local.browsers[label];
                            return (
                                <div key={label} className="flex items-center gap-2 text-sm">
                                    <span className="w-10 uppercase text-muted-foreground">{label}</span>
                                    <PhaseBadge phase={state.phase} />
                                    {state.message ? (
                                        <span className="truncate text-xs text-muted-foreground">{state.message}</span>
                                    ) : null}
                                </div>
                            );
                        })}

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

                        {files ? (
                            <div className="space-y-0.5 pt-1">
                                <div className="truncate">
                                    <Mono className="text-muted-foreground">mv2 {files.mv2 ?? "—"}</Mono>
                                </div>
                                <div className="truncate">
                                    <Mono className="text-muted-foreground">mv3 {files.mv3 ?? "—"}</Mono>
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-sm">Verification report</CardTitle>
                        {report ? <Badge variant="outline" className="text-green">saved</Badge> : null}
                    </CardHeader>
                    <CardContent>
                        <ReportForm
                            profile={profile}
                            saved={report}
                            onSubmit={onSubmitReport}
                            submitting={submitting}
                            error={submitError}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Score breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Breakdown breakdown={profile.breakdown} />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">{profile.mv2 ? "Manifest (MV3)" : "Manifest"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Manifest manifest={profile.manifest} />
                    </CardContent>
                </Card>

                {profile.mv2 ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Manifest (MV2)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Manifest manifest={profile.mv2} showName />
                        </CardContent>
                    </Card>
                ) : null}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Listeners ({profile.listeners.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
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
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Breakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
    const entries = BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0);
    if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing scored.</p>;
    const max = Math.max(...entries.map(([key]) => breakdown[key]), 1);
    return (
        <div className="space-y-1.5">
            {entries.map(([key, label]) => (
                <div key={key} className="flex items-center gap-3 text-sm">
                    <span className="w-48 shrink-0 text-muted-foreground">{label}</span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-blue">{breakdown[key]}</span>
                    <div className="h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-blue" style={{ width: `${(breakdown[key] / max) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function Manifest({ manifest, showName = false }: { manifest: ManifestSummary; showName?: boolean }) {
    const background =
        manifest.background === null ? "none" : `${manifest.background.type}(${manifest.background.scripts.join(", ")})`;
    return (
        <dl className="divide-y divide-border/60">
            {showName ? <Field label="Name">{manifest.name}</Field> : null}
            {manifest.id ? (
                <Field label="ID">
                    <Mono>{manifest.id}</Mono>
                </Field>
            ) : null}
            {manifest.description ? <Field label="Description">{manifest.description}</Field> : null}
            <Field label="Background">
                <Mono>{background}</Mono>
            </Field>
            <Field label="Permissions">{manifest.permissions.join(", ") || "—"}</Field>
            <Field label="Host permissions">{manifest.hostPermissions.join(", ") || "—"}</Field>
            <Field label="Content scripts">
                {manifest.contentScripts.length === 0
                    ? "—"
                    : manifest.contentScripts.map((cs, i) => (
                          <div key={i} className="truncate">
                              <Mono>
                                  {cs.matches.join(" | ")} → {cs.js.join(", ")}
                              </Mono>
                          </div>
                      ))}
            </Field>
            <Field label="Popup">{manifest.action?.defaultPopup ?? "—"}</Field>
            <Field label="Options page">{manifest.optionsPage ?? "—"}</Field>
            <Field label="New tab override">{manifest.chromeUrlOverrides.newtab ?? "—"}</Field>
        </dl>
    );
}
