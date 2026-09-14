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
import type { ExtensionProfile, OverallWorking, Report, ReportDraft } from "@extlens/protocol";
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
import { Mono } from "./shared";

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
                    {flags.hasPopup ? (
                        <Check
                            id="popup"
                            label="Popup works"
                            checked={draft.isPopupWorking}
                            onChange={(v) => set("isPopupWorking", v)}
                        />
                    ) : null}
                    {flags.hasSettings ? (
                        <Check
                            id="options"
                            label="Options page works"
                            checked={draft.isSettingsWorking}
                            onChange={(v) => set("isSettingsWorking", v)}
                        />
                    ) : null}
                    {flags.isNewTab ? (
                        <Check
                            id="newtab"
                            label="New tab works"
                            checked={draft.isNewTabWorking}
                            onChange={(v) => set("isNewTabWorking", v)}
                        />
                    ) : null}
                </div>
            </FieldSet>

            <FieldSeparator />

            <Field orientation="responsive">
                <FieldContent>
                    <FieldLabel htmlFor="overall">Overall</FieldLabel>
                    {reason ? <FieldDescription>{reason}</FieldDescription> : null}
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
