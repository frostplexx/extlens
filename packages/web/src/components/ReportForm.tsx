/**
 * The manual verification report.
 *
 * The rules are ExtPorter's, identical to the terminal client's: visible rows follow the manifest
 * (never ask whether an options page works when there is none — "no" and "not applicable" must stay
 * distinguishable in the data), and `overallWorking` is derived downward from the quick
 * assessments rather than left to the reviewer.
 */
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type {
    ExtensionProfile,
    OverallWorking,
    Report,
    ReportDraft,
    SurfaceResult,
    UiSurface,
} from "@extlens/protocol";
import { scoreSurfaces, VERDICT_LABELS, verdictFor } from "@extlens/protocol";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldSeparator,
    FieldSet,
    FieldTitle,
} from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Mono } from "./shared";
import { SurfaceTable } from "./SurfaceTable";

interface Flags {
    hasPopup: boolean;
    hasSettings: boolean;
    isNewTab: boolean;
}

function flagsOf(profile: ExtensionProfile): Flags {
    return {
        hasPopup: !!profile.manifest.action?.defaultPopup,
        hasSettings: !!profile.manifest.optionsPage,
        isNewTab: !!profile.manifest.chromeUrlOverrides?.newtab,
    };
}

interface Draft {
    installs: boolean;
    worksInMv2: boolean;
    needsLogin: boolean;
    isPopupWorking: boolean;
    isSettingsWorking: boolean;
    isNewTabWorking: boolean;
    isInteresting: boolean;
    overallWorking: OverallWorking;
    notes: string;
    listeners: ("untested" | "yes" | "no")[];
    surfaces: SurfaceResult[];
}

/** A failing quick assessment downgrades the overall verdict; "yes" must not survive one. */
function downgrade(d: Draft, flags: Flags): OverallWorking {
    if (!d.installs) return "no";
    if (d.needsLogin) return "could_not_test";
    if (flags.hasPopup && !d.isPopupWorking) return "no";
    if (flags.hasSettings && !d.isSettingsWorking) return "no";
    if (flags.isNewTab && !d.isNewTabWorking) return "no";
    return d.overallWorking;
}

/** Why the overall verdict is not the reviewer's to raise, spelled out under the control. */
function downgradeReason(d: Draft, flags: Flags): string | null {
    if (!d.installs) return "Forced to “broken”: the extension does not install.";
    if (d.needsLogin) return "Forced to “could not test”: the extension needs a login.";
    if (flags.hasPopup && !d.isPopupWorking) return "Forced to “broken”: the popup does not work.";
    if (flags.hasSettings && !d.isSettingsWorking) return "Forced to “broken”: the options page does not work.";
    if (flags.isNewTab && !d.isNewTabWorking) return "Forced to “broken”: the new tab override does not work.";
    return null;
}

export function ReportForm({
    profile,
    saved,
    onSubmit,
    submitting,
    error,
    submitLabel,
    footer,
}: {
    profile: ExtensionProfile;
    saved: Report | null;
    onSubmit: (draft: ReportDraft) => void;
    submitting: boolean;
    error: string | null;
    /** Wording for the primary action; defaults to save/update. */
    submitLabel?: string;
    /** Extra controls beside it — the review pass puts Skip here. */
    footer?: React.ReactNode;
}) {
    const flags = useMemo(() => flagsOf(profile), [profile]);
    const [startedAt, setStartedAt] = useState(() => Date.now());
    const [draft, setDraft] = useState<Draft>(() => initial(profile, saved));

    // A new extension resets the answers and the verification clock; inheriting the previous
    // extension's form would quietly record the wrong thing.
    useEffect(() => {
        setDraft(initial(profile, saved));
        setStartedAt(Date.now());
    }, [profile.id, saved]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setDraft((d) => {
            const next = { ...d, [key]: value };
            return { ...next, overallWorking: downgrade(next, flags) };
        });

    const reason = downgradeReason(draft, flags);
    const summary = scoreSurfaces(draft.surfaces);
    const verdict = verdictFor(draft.surfaces);

    const submit = () =>
        onSubmit({
            extensionId: profile.id,
            tested: true,
            verificationDurationSecs: (Date.now() - startedAt) / 1000,
            installs: draft.installs,
            worksInMv2: draft.worksInMv2,
            needsLogin: draft.needsLogin,
            // A capability the manifest never declared is null, not false: it was not tested.
            isPopupWorking: flags.hasPopup ? draft.isPopupWorking : null,
            isSettingsWorking: flags.hasSettings ? draft.isSettingsWorking : null,
            isNewTabWorking: flags.isNewTab ? draft.isNewTabWorking : null,
            isInteresting: draft.isInteresting,
            overallWorking: draft.overallWorking,
            notes: draft.notes,
            listeners: profile.listeners.map((l, i) => ({
                api: l.api,
                file: l.file,
                line: l.line,
                status: draft.listeners[i] ?? "untested",
            })),
            surfaces: draft.surfaces,
            // Derived, not asked: both clients compute them the same way (protocol/verdict.ts) so
            // a corpus reviewed in two places stays comparable.
            verdict,
            score: summary.score,
        });

    return (
        <FieldGroup>
            <FieldSet>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <Check id="installs" label="Installs" checked={draft.installs} onChange={(v) => set("installs", v)} />
                    <Check id="mv2" label="Works in MV2" checked={draft.worksInMv2} onChange={(v) => set("worksInMv2", v)} />
                    <Check id="login" label="Needs login" checked={draft.needsLogin} onChange={(v) => set("needsLogin", v)} />
                    <Check
                        id="interesting"
                        label="Interesting"
                        checked={draft.isInteresting}
                        onChange={(v) => set("isInteresting", v)}
                    />
                </div>
            </FieldSet>

            <FieldSeparator />

            {/* Per-surface results, one row per thing this extension actually exposes. The verdict
                and the score below are computed from them rather than asked for separately —
                a reviewer who has judged every surface has already given the answer. */}
            <Field>
                <FieldLabel>User-facing surfaces</FieldLabel>
                <FieldDescription>
                    Judge each surface the extension has. Leave one untested rather than guessing, and
                    mark it “can’t test” when the harness is what is in the way.
                </FieldDescription>
                <SurfaceTable
                    detected={profile.surfaces ?? []}
                    results={draft.surfaces}
                    onChange={(surface: UiSurface, patch) =>
                        setDraft((d) => ({
                            ...d,
                            surfaces: d.surfaces.map((r) => (r.surface === surface ? { ...r, ...patch } : r)),
                        }))
                    }
                />
            </Field>

            <Field orientation="responsive">
                <FieldContent>
                    <FieldLabel>Verdict</FieldLabel>
                    <FieldDescription>
                        {summary.testable === 0
                            ? "Nothing testable yet — judge a surface above."
                            : `${summary.working} working, ${summary.partial} partial, ${summary.broken} broken of ${summary.testable} testable` +
                              (summary.notTestable > 0 ? ` · ${summary.notTestable} excluded as untestable` : "")}
                    </FieldDescription>
                </FieldContent>
                <div className="flex items-center gap-3">
                    <Badge variant={verdictTone(verdict)}>{VERDICT_LABELS[verdict]}</Badge>
                    <span className="text-sm tabular-nums text-muted-foreground">
                        {summary.score === null ? "—" : summary.score.toFixed(2)}
                    </span>
                </div>
            </Field>

            <Field orientation="responsive">
                <FieldContent>
                    <FieldLabel htmlFor="overall">Overall (legacy)</FieldLabel>
                    <FieldDescription>
                        {reason ?? "Kept so reports stay comparable with the pre-surface corpus."}
                    </FieldDescription>
                </FieldContent>
                <Select
                    value={draft.overallWorking}
                    onValueChange={(value) => setDraft((d) => ({ ...d, overallWorking: value as OverallWorking }))}
                >
                    <SelectTrigger id="overall" className="w-48">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="yes">Working</SelectItem>
                        <SelectItem value="no">Broken</SelectItem>
                        <SelectItem value="could_not_test">Could not test</SelectItem>
                    </SelectContent>
                </Select>
            </Field>

            {profile.listeners.length > 0 ? (
                <Field>
                    <FieldLabel>Listeners</FieldLabel>
                    <FieldDescription>
                        Each event the analyzer found. Leave one untested rather than guessing.
                    </FieldDescription>
                    <div className="max-h-64 space-y-1.5 overflow-auto rounded-md border p-2">
                        {profile.listeners.map((l, i) => (
                            <div key={`${l.api}:${l.file}:${l.line}`} className="flex items-center gap-2">
                                <Select
                                    value={draft.listeners[i] ?? "untested"}
                                    onValueChange={(value) =>
                                        setDraft((d) => {
                                            const next = [...d.listeners];
                                            next[i] = value as "untested" | "yes" | "no";
                                            return { ...d, listeners: next };
                                        })
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-28 shrink-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="untested">untested</SelectItem>
                                        <SelectItem value="yes">works</SelectItem>
                                        <SelectItem value="no">broken</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="min-w-0 truncate" title={`${l.api} — ${l.file}:${l.line}`}>
                                    <Mono>{l.api}</Mono>
                                    <Mono className="text-muted-foreground">
                                        {" "}
                                        {l.file}:{l.line}
                                    </Mono>
                                </div>
                            </div>
                        ))}
                    </div>
                </Field>
            ) : null}

            <Field>
                <FieldLabel htmlFor="notes">Notes</FieldLabel>
                <Textarea
                    id="notes"
                    rows={3}
                    value={draft.notes}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="What broke, what you clicked, anything the next reader needs."
                />
            </Field>

            {error ? <FieldError>{error}</FieldError> : null}

            <Field orientation="horizontal">
                <Button onClick={submit} disabled={submitting}>
                    {submitting ? <Spinner /> : <Save className="size-4" />}
                    {submitLabel ?? (saved ? "Update report" : "Save report")}
                </Button>
                {footer}
                <FieldDescription>{Math.round((Date.now() - startedAt) / 1000)}s on this extension</FieldDescription>
            </Field>
        </FieldGroup>
    );
}

function initial(profile: ExtensionProfile, saved: Report | null): Draft {
    return {
        installs: saved?.installs ?? true,
        worksInMv2: saved?.worksInMv2 ?? true,
        needsLogin: saved?.needsLogin ?? false,
        isPopupWorking: saved?.isPopupWorking ?? true,
        isSettingsWorking: saved?.isSettingsWorking ?? true,
        isNewTabWorking: saved?.isNewTabWorking ?? true,
        isInteresting: saved?.isInteresting ?? false,
        overallWorking: saved?.overallWorking ?? "yes",
        notes: saved?.notes ?? "",
        listeners: profile.listeners.map(
            (l) => saved?.listeners.find((r) => r.api === l.api && r.file === l.file)?.status ?? "untested",
        ),
        // One row per detected surface, resuming whatever the saved report said about it. A saved
        // answer for a surface that is no longer detected is dropped: the extension changed.
        surfaces: (profile.surfaces ?? []).map(
            ({ surface }) =>
                saved?.surfaces?.find((r) => r.surface === surface) ?? { surface, status: "untested", note: "" },
        ),
    };
}

function Check({
    id,
    label,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <Field orientation="horizontal">
            <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
            <FieldLabel htmlFor={id} className="font-normal">
                <FieldTitle>{label}</FieldTitle>
            </FieldLabel>
        </Field>
    );
}

/** Badge tone for a verdict. Partial is a warning, not a failure — it is the common outcome. */
function verdictTone(verdict: ReturnType<typeof verdictFor>): "default" | "secondary" | "destructive" | "outline" {
    if (verdict === "working") return "default";
    if (verdict === "not_working") return "destructive";
    return "secondary";
}
