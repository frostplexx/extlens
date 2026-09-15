/**
 * The manual verification report.
 *
 * The rules are ExtPorter's, identical to the terminal client's: visible rows follow the manifest
 * (never ask whether an options page works when there is none — "no" and "not applicable" must stay
 * distinguishable in the data), and `overallWorking` is derived downward from the quick
 * assessments rather than left to the reviewer.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
    ExtensionProfile,
    OverallWorking,
    Report,
    ReportDraft,
    SurfaceResult,
    UiSurface,
} from "@extlens/protocol";
import { scoreSurfaces, VERDICT_LABELS, verdictFor } from "@extlens/protocol";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
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
import type { DetectedSurface } from "@extlens/protocol";
import { Badge } from "@/components/ui/badge";
import { propagate } from "@/lib/quick-assessment";
import { Mono } from "./shared";
import { SurfaceTable } from "./SurfaceTable";

/**
 * Surfaces to ask about, falling back to the manifest summary.
 *
 * A host running an older build sends no `surfaces`, and the form then said "no user-facing
 * surfaces detected" for an extension whose popup was listed two panes away — which reads as a
 * claim about the extension rather than about the host. The manifest summary is always present,
 * so the three surfaces it can describe are recoverable without it.
 */
function surfacesToAsk(profile: ExtensionProfile): DetectedSurface[] {
    if (profile.surfaces?.length) return profile.surfaces;
    const fallback: DetectedSurface[] = [];
    const popup = profile.manifest.action?.defaultPopup;
    if (popup) fallback.push({ surface: "popup", evidence: `manifest summary: ${popup}` });
    if (profile.manifest.optionsPage) {
        fallback.push({ surface: "options_page", evidence: `manifest summary: ${profile.manifest.optionsPage}` });
    }
    if (profile.manifest.chromeUrlOverrides?.newtab) {
        fallback.push({
            surface: "new_tab",
            evidence: `manifest summary: ${profile.manifest.chromeUrlOverrides.newtab}`,
        });
    }
    if (profile.manifest.contentScripts?.length) {
        fallback.push({ surface: "page_interaction", evidence: "manifest summary: content scripts" });
    }
    return fallback;
}

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
    notes: string;
    surfaces: SurfaceResult[];
}

export function ReportForm({
    profile,
    saved,
    onSubmit,
    submitting,
    error,
    submitLabel,
    footer,
    onOpenUrl,
    readOnly = false,
    onRequestEdit,
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
    /** Open a page in the running test browsers; omitted where that is not wired up. */
    onOpenUrl?: (url: string) => void;
    /**
     * Show what was recorded without offering to change it.
     *
     * Browsing is looking, not reviewing. An editable form on every click invites an accidental
     * edit to someone else's report, and — worse — the verification clock used to start the moment
     * an extension was opened, so merely reading the data recorded time as if it were testing.
     */
    readOnly?: boolean;
    onRequestEdit?: () => void;
}) {
    const flags = useMemo(() => flagsOf(profile), [profile]);
    const detected = useMemo(() => surfacesToAsk(profile), [profile]);
    // Null until the reviewer actually starts: time spent reading is not time spent verifying.
    const [startedAt, setStartedAt] = useState<number | null>(() => (readOnly ? null : Date.now()));
    const [draft, setDraft] = useState<Draft>(() => initial(profile, saved));
    /**
     * Statuses as they were before "does not install" / "needs an account" overwrote them, so a
     * mis-click costs a second toggle rather than the reviewer's work.
     */
    const snapshot = useRef<SurfaceResult[] | null>(null);


    // A new extension resets the answers and the verification clock; inheriting the previous
    // extension's form would quietly record the wrong thing.
    useEffect(() => {
        setDraft(initial(profile, saved));
        setStartedAt(readOnly ? null : Date.now());
        // A snapshot belongs to the extension it was taken from; carrying it across would restore
        // one extension's judgements onto another's form.
        snapshot.current = null;
    }, [profile.id, saved, readOnly]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setDraft((d) => {
            const next = { ...d, [key]: value };
            // Two of these four answers settle every surface below them; propagating saves the
            // reviewer filling in an outcome that was already decided.
            if (key !== "installs" && key !== "needsLogin") return next;
            const result = propagate(next.surfaces, { installs: next.installs, needsLogin: next.needsLogin }, snapshot.current);
            snapshot.current = result.snapshot;
            return { ...next, surfaces: result.surfaces };
        });

    // Recomputed rather than stored: it is a statement about the current answers, and storing it
    // would be one more thing to keep in step with them.
    const propagated = propagate(draft.surfaces, { installs: draft.installs, needsLogin: draft.needsLogin }, snapshot.current)
        .because;
    // Only offer the undo when there is something to undo: a saved report that already said "needs
    // an account" describes the same state without anything having been overwritten.
    const canUndo = snapshot.current !== null;

    const summary = scoreSurfaces(draft.surfaces);
    const verdict = verdictFor(draft.surfaces);

    const submit = () =>
        onSubmit({
            extensionId: profile.id,
            tested: true,
            verificationDurationSecs: startedAt === null ? null : (Date.now() - startedAt) / 1000,
            installs: draft.installs,
            worksInMv2: draft.worksInMv2,
            needsLogin: draft.needsLogin,
            // A capability the manifest never declared is null, not false: it was not tested.
            isPopupWorking: flags.hasPopup ? draft.isPopupWorking : null,
            isSettingsWorking: flags.hasSettings ? draft.isSettingsWorking : null,
            isNewTabWorking: flags.isNewTab ? draft.isNewTabWorking : null,
            isInteresting: draft.isInteresting,
            // Superseded by the per-surface results, which is where behaviour is actually visible.
            // Still sent, as null, so the field keeps meaning "not answered" rather than "no".
            overallWorking: null,
            notes: draft.notes,
            // Listeners are no longer judged on their own: a reviewer cannot watch one fire. They
            // appear as evidence under the surface each exercises (see SurfaceTable).
            listeners: [],
            surfaces: draft.surfaces,
            // Derived, not asked: both clients compute them the same way (protocol/verdict.ts) so
            // a corpus reviewed in two places stays comparable.
            verdict,
            score: summary.score,
        });

    return (
        <FieldGroup>
            {/* Facts about the attempt rather than about a surface. Labelled switches, not a grid
                of bare checkboxes: three of these change how the whole result should be read — an
                extension that does not install, or that was already broken in MV2, says nothing
                about the migration — so the reviewer should see what each one means. */}
            <FieldSet>
                <ItemGroup className="gap-2">
                    <Toggle
                        id="installs"
                        label="Installs"
                        hint="Chrome accepted it. If not, nothing below is testable."
                        checked={draft.installs}
                        onChange={(v) => set("installs", v)}
                        readOnly={readOnly}
                    />
                    <Toggle
                        id="mv2"
                        label="Worked in MV2"
                        hint="The original worked. If it did not, a failure here says nothing about the migration."
                        checked={draft.worksInMv2}
                        onChange={(v) => set("worksInMv2", v)}
                        readOnly={readOnly}
                    />
                    <Toggle
                        id="login"
                        label="Needs an account"
                        hint="Needs a login, a device or a paid service before it can be exercised."
                        checked={draft.needsLogin}
                        onChange={(v) => set("needsLogin", v)}
                        readOnly={readOnly}
                    />
                    <Toggle
                        id="interesting"
                        label="Interesting"
                        hint="Worth coming back to: an unusual failure, or a hard migration done well."
                        checked={draft.isInteresting}
                        onChange={(v) => set("isInteresting", v)}
                        readOnly={readOnly}
                    />
                </ItemGroup>
            </FieldSet>

            <FieldSeparator />

            {/* Per-surface results, one row per thing this extension actually exposes. The verdict
                and the score below are computed from them rather than asked for separately —
                a reviewer who has judged every surface has already given the answer. */}
            <Field>
                <FieldLabel>User-facing surfaces</FieldLabel>
                <FieldDescription>
                    {propagated ? (
                        <span className="text-peach">
                            {propagated}
                            {canUndo ? " Turn that answer back off to restore your judgements." : ""}
                        </span>
                    ) : (
                        <>
                            Judge each surface the extension has. Leave one untested rather than guessing, and
                            mark it “can’t test” when the harness is what is in the way.
                        </>
                    )}
                </FieldDescription>
                <SurfaceTable
                    readOnly={readOnly}
                    detected={detected}
                    contentScriptMatches={(profile.manifest.contentScripts ?? []).flatMap((cs) => cs.matches)}
                    onOpenUrl={onOpenUrl}
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


            <Field>
                <FieldLabel htmlFor="notes">Notes</FieldLabel>
                {readOnly ? (
                    <p className="text-sm text-muted-foreground">{draft.notes || "—"}</p>
                ) : (
                    <Textarea
                        id="notes"
                        rows={3}
                        value={draft.notes}
                        onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                        placeholder="What broke, what you clicked, anything the next reader needs."
                    />
                )}
            </Field>

            {error ? <FieldError>{error}</FieldError> : null}

            <Field orientation="horizontal">
                {readOnly ? (
                    <>
                        <Button variant="outline" onClick={onRequestEdit} disabled={!onRequestEdit}>
                            <Pencil className="size-4" />
                            {saved ? "Edit report" : "Start a report"}
                        </Button>
                        <FieldDescription>
                            {saved ? "Recorded earlier. Editing starts a fresh timing." : "Nothing recorded yet."}
                        </FieldDescription>
                    </>
                ) : (
                    <>
                        <Button onClick={submit} disabled={submitting}>
                            {submitting ? <Spinner /> : <Save className="size-4" />}
                            {submitLabel ?? (saved ? "Update report" : "Save report")}
                        </Button>
                        {footer}
                        <FieldDescription>
                            {startedAt === null ? "" : `${Math.round((Date.now() - startedAt) / 1000)}s on this extension`}
                        </FieldDescription>
                    </>
                )}
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
        notes: saved?.notes ?? "",
        // One row per detected surface, resuming whatever the saved report said about it. A saved
        // answer for a surface that is no longer detected is dropped: the extension changed.
        surfaces: surfacesToAsk(profile).map(
            ({ surface }) =>
                saved?.surfaces?.find((r) => r.surface === surface) ?? { surface, status: "untested", note: "" },
        ),
    };
}

function Toggle({
    id,
    label,
    hint,
    checked,
    onChange,
    readOnly = false,
}: {
    id: string;
    label: string;
    hint: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    readOnly?: boolean;
}) {
    return (
        <Item variant="outline" size="sm" asChild>
            <label htmlFor={id} className="cursor-pointer" title={hint}>
                <ItemContent>
                    <ItemTitle>{label}</ItemTitle>
                    <ItemDescription className="hidden lg:block">{hint}</ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={readOnly} />
                </ItemActions>
            </label>
        </Item>
    );
}

/** Badge tone for a verdict. Partial is a warning, not a failure — it is the common outcome. */
function verdictTone(verdict: ReturnType<typeof verdictFor>): "default" | "secondary" | "destructive" | "outline" {
    if (verdict === "working") return "default";
    if (verdict === "not_working") return "destructive";
    return "secondary";
}
