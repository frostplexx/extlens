/**
 * The manual verification form.
 *
 * The rules are ExtPorter's and identical to the terminal client's — conditional rows follow the
 * manifest, and `overallWorking` is derived downward from the quick assessments — but the controls
 * are real ones. A checkbox that shows its state without a cursor is the single biggest
 * ergonomic win of a browser over a TUI here, because the reviewer is looking at Chrome, not at
 * this form, and glancing back should not require re-reading a list.
 */
import React, { useEffect, useMemo, useState } from "react";
import type { ExtensionProfile, OverallWorking, Report, ReportDraft } from "@extlens/protocol";
import { Button } from "./primitives.js";

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

/** A failing quick assessment downgrades the overall verdict; "yes" must not survive it. */
function downgrade(d: Draft, flags: Flags): OverallWorking {
    if (!d.installs) return "no";
    if (d.needsLogin) return "could_not_test";
    if (flags.hasPopup && !d.isPopupWorking) return "no";
    if (flags.hasSettings && !d.isSettingsWorking) return "no";
    if (flags.isNewTab && !d.isNewTabWorking) return "no";
    return d.overallWorking;
}

export function ReportForm({
    profile,
    saved,
    onSubmit,
    submitting,
    error,
}: {
    profile: ExtensionProfile;
    saved: Report | null;
    onSubmit: (draft: ReportDraft) => void;
    submitting: boolean;
    error: string | null;
}) {
    const flags = useMemo(() => flagsOf(profile), [profile]);
    const [startedAt, setStartedAt] = useState(() => Date.now());
    const [draft, setDraft] = useState<Draft>(() => initial(profile, saved));

    // Switching extensions must reset the form and the verification clock, or the next
    // extension inherits the previous one's answers and its elapsed time.
    useEffect(() => {
        setDraft(initial(profile, saved));
        setStartedAt(Date.now());
    }, [profile.id, saved]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setDraft((d) => {
            const next = { ...d, [key]: value };
            return { ...next, overallWorking: downgrade(next, flags) };
        });

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
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <Check label="installs" checked={draft.installs} onChange={(v) => set("installs", v)} />
                <Check label="works in mv2" checked={draft.worksInMv2} onChange={(v) => set("worksInMv2", v)} />
                <Check label="needs login" checked={draft.needsLogin} onChange={(v) => set("needsLogin", v)} />
                <Check label="interesting" checked={draft.isInteresting} onChange={(v) => set("isInteresting", v)} />
                {flags.hasPopup ? (
                    <Check label="popup works" checked={draft.isPopupWorking} onChange={(v) => set("isPopupWorking", v)} />
                ) : null}
                {flags.hasSettings ? (
                    <Check
                        label="options page works"
                        checked={draft.isSettingsWorking}
                        onChange={(v) => set("isSettingsWorking", v)}
                    />
                ) : null}
                {flags.isNewTab ? (
                    <Check label="new tab works" checked={draft.isNewTabWorking} onChange={(v) => set("isNewTabWorking", v)} />
                ) : null}
            </div>

            <label className="flex items-center gap-3">
                <span className="w-36 text-subtext0">overall</span>
                <select
                    value={draft.overallWorking}
                    onChange={(e) => setDraft((d) => ({ ...d, overallWorking: e.target.value as OverallWorking }))}
                    className="rounded bg-surface0 px-2 py-1 text-text ring-1 ring-inset ring-surface1 focus:outline-none focus:ring-mauve"
                >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                    <option value="could_not_test">could not test</option>
                </select>
            </label>

            {profile.listeners.length > 0 ? (
                <div>
                    <div className="mb-1 text-subtext0">listeners</div>
                    <div className="max-h-56 space-y-1 overflow-auto rounded border border-surface0 p-2">
                        {profile.listeners.map((l, i) => (
                            <div key={`${l.api}:${l.file}:${l.line}`} className="flex items-center gap-2">
                                <select
                                    value={draft.listeners[i] ?? "untested"}
                                    onChange={(e) =>
                                        setDraft((d) => {
                                            const next = [...d.listeners];
                                            next[i] = e.target.value as "untested" | "yes" | "no";
                                            return { ...d, listeners: next };
                                        })
                                    }
                                    className="w-24 rounded bg-surface0 px-1.5 py-0.5 text-xs ring-1 ring-inset ring-surface1 focus:outline-none focus:ring-mauve"
                                >
                                    <option value="untested">untested</option>
                                    <option value="yes">works</option>
                                    <option value="no">broken</option>
                                </select>
                                <span className="truncate" title={`${l.api} — ${l.file}:${l.line}`}>
                                    {l.api}
                                    <span className="text-overlay0">
                                        {" "}
                                        {l.file}:{l.line}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <textarea
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="notes"
                rows={3}
                className="w-full resize-y rounded bg-surface0 px-2 py-1.5 text-text ring-1 ring-inset ring-surface1 placeholder:text-overlay0 focus:outline-none focus:ring-mauve"
            />

            {error ? <div className="text-red">{error}</div> : null}

            <div className="flex items-center gap-2">
                <Button tone="primary" onClick={submit} disabled={submitting}>
                    {submitting ? "saving…" : saved ? "update report" : "save report"}
                </Button>
                <span className="text-overlay0">
                    {Math.round((Date.now() - startedAt) / 1000)}s on this extension
                </span>
            </div>
        </div>
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
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2 py-0.5 select-none">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-mauve"
            />
            <span>{label}</span>
        </label>
    );
}
