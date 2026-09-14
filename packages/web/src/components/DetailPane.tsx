/**
 * Everything known about the selected extension, plus the controls that act on it.
 *
 * The browser launch buttons are the point of interest: they call `local.launch` on the bridge,
 * which spawns Chrome for Testing in the server process. The page never touches a process — it
 * asks the thing that served it to, which is why a web UI can do this at all.
 */
import React from "react";
import type { ExtensionProfile, FileRefs, ManifestSummary, Report, ReportDraft, ScoreBreakdown } from "@extlens/protocol";
import type { BrowserState } from "@extlens/session";
import type { LocalSnapshot } from "../types.js";
import { Button, EmptyState, KeyValue, Pill, ScoreBar, Section } from "./primitives.js";
import { ReportForm } from "./ReportForm.js";

const BREAKDOWN_LABELS: [keyof ScoreBreakdown, string][] = [
    ["webRequest", "webRequest"],
    ["htmlLines", "html lines"],
    ["storageLocal", "storage.local"],
    ["backgroundPage", "background page"],
    ["contentScripts", "content scripts"],
    ["dangerousPermissions", "dangerous permissions"],
    ["hostPermissions", "host permissions"],
    ["cryptoPatterns", "crypto patterns"],
    ["networkRequests", "network requests"],
    ["extensionSize", "size (100KB units)"],
    ["apiRenames", "api renames (host)"],
    ["manifestChanges", "manifest changes (host)"],
    ["fileModifications", "file modifications (host)"],
    ["webRequestToDnr", "webRequest→DNR (host)"],
];

const PHASE_TONE: Record<BrowserState["phase"], "neutral" | "good" | "warn" | "bad" | "info"> = {
    idle: "neutral",
    launching: "warn",
    detecting: "warn",
    downloading: "warn",
    loaded: "good",
    failed: "bad",
    closed: "neutral",
};

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
    onClose,
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
    onClose: () => void;
    onAnswerPrompt: (accept: boolean) => void;
    onSubmitReport: (draft: ReportDraft) => void;
    submitting: boolean;
    submitError: string | null;
}) {
    if (loading) return <EmptyState>loading profile…</EmptyState>;
    if (error) return <EmptyState>{error}</EmptyState>;
    if (!profile) return <EmptyState>select an extension</EmptyState>;

    const prompt = local.prompts[0];

    return (
        <div className="h-full overflow-auto">
            <header className="px-4 py-3">
                <h2 className="truncate text-base font-semibold text-text" title={profile.name}>
                    {profile.name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-subtext0">
                    <span>v{profile.version ?? "?"}</span>
                    <Pill tone={profile.manifestVersion === 3 ? "info" : "neutral"}>mv{profile.manifestVersion}</Pill>
                    {profile.hasMv3 ? <Pill tone="good">mv3 variant</Pill> : null}
                    <span>{formatBytes(profile.sizeBytes)}</span>
                </div>
                <div className="mt-2 max-w-xs">
                    <ScoreBar score={profile.score} />
                </div>
                {profile.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {profile.tags.map((tag) => (
                            <Pill key={tag}>{tag}</Pill>
                        ))}
                    </div>
                ) : null}
            </header>

            <Section
                title="test browsers"
                right={
                    <div className="flex gap-2">
                        <Button tone="primary" onClick={onLaunch} disabled={!files}>
                            launch
                        </Button>
                        <Button onClick={onClose}>close</Button>
                    </div>
                }
            >
                <div className="space-y-1">
                    {(["mv2", "mv3"] as const).map((label) => {
                        const state = local.browsers[label];
                        return (
                            <div key={label} className="flex items-center gap-2">
                                <span className="w-10 text-subtext0">{label}</span>
                                <Pill tone={PHASE_TONE[state.phase]}>{state.phase}</Pill>
                                {state.message ? <span className="truncate text-overlay0">{state.message}</span> : null}
                            </div>
                        );
                    })}
                    {prompt ? (
                        <div className="mt-2 rounded border border-peach/30 bg-peach/10 p-2">
                            <div className="text-peach">{prompt.message}</div>
                            <div className="mt-1 text-overlay0">
                                download Chrome for Testing into {local.browserDir}?
                            </div>
                            <div className="mt-2 flex gap-2">
                                <Button tone="primary" onClick={() => onAnswerPrompt(true)}>
                                    download
                                </Button>
                                <Button onClick={() => onAnswerPrompt(false)}>skip</Button>
                            </div>
                        </div>
                    ) : null}
                    {files ? (
                        <div className="pt-1 text-overlay0">
                            <div className="truncate">mv2 {files.mv2 ?? "—"}</div>
                            <div className="truncate">mv3 {files.mv3 ?? "—"}</div>
                        </div>
                    ) : null}
                </div>
            </Section>

            <Section title={report ? "report (saved)" : "report"}>
                <ReportForm
                    profile={profile}
                    saved={report}
                    onSubmit={onSubmitReport}
                    submitting={submitting}
                    error={submitError}
                />
            </Section>

            <Section title="score breakdown">
                <Breakdown breakdown={profile.breakdown} />
            </Section>

            <Section title={profile.mv2 ? "manifest (mv3)" : "manifest"}>
                <Manifest manifest={profile.manifest} />
            </Section>

            {profile.mv2 ? (
                <Section title="manifest (mv2)">
                    <Manifest manifest={profile.mv2} showName />
                </Section>
            ) : null}

            <Section title={`listeners (${profile.listeners.length})`}>
                {profile.listeners.length === 0 ? (
                    <div className="text-overlay0">none detected</div>
                ) : (
                    <ul className="space-y-0.5">
                        {profile.listeners.map((l) => (
                            <li key={`${l.api}:${l.file}:${l.line}`} className="truncate">
                                <span className="text-text">{l.api}</span>
                                <span className="text-overlay0">
                                    {" "}
                                    {l.file}:{l.line}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

function Breakdown({ breakdown }: { breakdown: ScoreBreakdown }) {
    const entries = BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0);
    if (entries.length === 0) return <div className="text-overlay0">nothing scored</div>;
    const max = Math.max(...entries.map(([key]) => breakdown[key]), 1);
    return (
        <div className="space-y-1">
            {entries.map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                    <span className="w-52 shrink-0 text-subtext0">{label}</span>
                    <span className="w-8 text-right tabular-nums text-blue">{breakdown[key]}</span>
                    <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-surface0">
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
        <dl>
            {showName ? <KeyValue label="name">{manifest.name}</KeyValue> : null}
            {manifest.id ? <KeyValue label="id">{manifest.id}</KeyValue> : null}
            {manifest.description ? <KeyValue label="description">{manifest.description}</KeyValue> : null}
            <KeyValue label="background">{background}</KeyValue>
            <KeyValue label="permissions">{manifest.permissions.join(", ") || "—"}</KeyValue>
            <KeyValue label="host permissions">{manifest.hostPermissions.join(", ") || "—"}</KeyValue>
            <KeyValue label="content scripts">
                {manifest.contentScripts.length === 0
                    ? "—"
                    : manifest.contentScripts.map((cs, i) => (
                          <div key={i}>
                              {cs.matches.join(" | ")} → {cs.js.join(", ")}
                          </div>
                      ))}
            </KeyValue>
            <KeyValue label="popup">{manifest.action?.defaultPopup ?? "—"}</KeyValue>
            <KeyValue label="options page">{manifest.optionsPage ?? "—"}</KeyValue>
            <KeyValue label="new tab override">{manifest.chromeUrlOverrides.newtab ?? "—"}</KeyValue>
        </dl>
    );
}
