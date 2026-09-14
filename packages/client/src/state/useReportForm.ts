/**
 * The manual verification report form.
 *
 * Two rules from ExtPorter are encoded here rather than left to the reviewer. First, the visible
 * rows depend on the manifest: an extension with no options page must not be asked whether its
 * options page works, because "no" and "not applicable" would be indistinguishable in the data.
 * Second, `overallWorking` is derived downward — if the extension does not install, or a
 * capability it declares is broken, "overall: yes" is not a state the form can be left in.
 */
import { useCallback, useMemo, useState } from "react";
import type { ExtensionProfile, OverallWorking, Report, ReportDraft } from "@extlens/protocol";
import type { ExtlensClient } from "../api.js";
import type { ReportDraftForm } from "../types.js";
import { buildReportRows } from "../components/report-form.js";

/** Which conditional rows this extension's manifest calls for. */
export interface ManifestFlags {
    hasPopup: boolean;
    hasSettings: boolean;
    isNewTab: boolean;
}

export function manifestFlags(profile: ExtensionProfile | null): ManifestFlags {
    const manifest = profile?.manifest;
    return {
        hasPopup: !!manifest?.action?.defaultPopup,
        hasSettings: !!manifest?.optionsPage,
        isNewTab: !!manifest?.chromeUrlOverrides?.newtab,
    };
}

/** ExtPorter's dependency rule: a failing quick assessment downgrades the overall verdict. */
export function downgradeOverall(f: ReportDraftForm, flags: ManifestFlags): OverallWorking {
    if (!f.installs) return "no";
    if (f.needsLogin) return "could_not_test";
    if (flags.hasPopup && !f.isPopupWorking) return "no";
    if (flags.hasSettings && !f.isSettingsWorking) return "no";
    if (flags.isNewTab && !f.isNewTabWorking) return "no";
    return f.overallWorking;
}

const OVERALL_CYCLE = ["yes", "no", "could_not_test"] as const;
const LISTENER_CYCLE = ["untested", "yes", "no"] as const;

export interface ReportForm {
    form: ReportDraftForm | null;
    rows: ReturnType<typeof buildReportRows>;
    flags: ManifestFlags;
    open: (profile: ExtensionProfile | null, saved: Report | null) => void;
    close: () => void;
    move: (delta: 1 | -1) => void;
    cycle: (delta: 1 | -1) => void;
    toggleNotes: () => void;
    setNotes: (value: string) => void;
    submit: () => void;
}

export function useReportForm(
    client: ExtlensClient | null,
    profile: ExtensionProfile | null,
    subjectId: string | null,
    /** Called after a successful submit; returns false at the end of the corpus. */
    onSubmitted: () => Promise<boolean>,
    onExhausted: () => void,
): ReportForm {
    const [form, setForm] = useState<ReportDraftForm | null>(null);
    const flags = useMemo(() => manifestFlags(profile), [profile]);
    const rows = useMemo(
        () => buildReportRows({ ...flags, listenerCount: profile?.listeners.length ?? 0 }),
        [flags, profile?.listeners.length],
    );

    const open = useCallback((p: ExtensionProfile | null, saved: Report | null) => {
        if (!p) return;
        // Re-opening a reviewed extension resumes the saved answers instead of starting blank.
        const statuses = p.listeners.map(
            (l) => saved?.listeners.find((r) => r.api === l.api && r.file === l.file)?.status ?? "untested",
        );
        setForm({
            installs: saved?.installs ?? true,
            worksInMv2: saved?.worksInMv2 ?? true,
            needsLogin: saved?.needsLogin ?? false,
            isPopupWorking: saved?.isPopupWorking ?? true,
            isSettingsWorking: saved?.isSettingsWorking ?? true,
            isNewTabWorking: saved?.isNewTabWorking ?? true,
            isInteresting: saved?.isInteresting ?? false,
            overallWorking: saved?.overallWorking ?? "yes",
            notes: saved?.notes ?? "",
            listenerStatus: statuses,
            cursor: 0,
            notesFocused: false,
            saving: false,
            savedId: null,
            error: null,
            verificationStart: Date.now(),
        });
    }, []);

    const close = useCallback(() => setForm(null), []);

    const move = useCallback(
        (delta: 1 | -1) => {
            setForm((f) => {
                if (!f || f.notesFocused || rows.length === 0) return f;
                return { ...f, cursor: (f.cursor + delta + rows.length) % rows.length };
            });
        },
        [rows.length],
    );

    const cycle = useCallback(
        (delta: 1 | -1) => {
            setForm((f) => {
                if (!f || f.notesFocused) return f;
                const row = rows[f.cursor];
                if (!row) return f;
                if (row.kind === "listener") {
                    const statuses = [...f.listenerStatus];
                    const at = LISTENER_CYCLE.indexOf(statuses[row.index] ?? "untested");
                    statuses[row.index] = LISTENER_CYCLE[(at + delta + 3) % 3];
                    return { ...f, listenerStatus: statuses };
                }
                if (row.kind === "boolean") {
                    const next = { ...f, [row.field]: !f[row.field] };
                    return { ...next, overallWorking: downgradeOverall(next, flags) };
                }
                if (row.kind === "overall") {
                    const at = OVERALL_CYCLE.indexOf(f.overallWorking);
                    return { ...f, overallWorking: OVERALL_CYCLE[(at + delta + 3) % 3] };
                }
                return f;
            });
        },
        [rows, flags],
    );

    const toggleNotes = useCallback(() => setForm((f) => (f ? { ...f, notesFocused: !f.notesFocused } : f)), []);
    const setNotes = useCallback((value: string) => setForm((f) => (f ? { ...f, notes: value } : f)), []);

    const submit = useCallback(() => {
        if (!form || !subjectId || !profile || form.saving || !client) return;
        setForm((f) => (f ? { ...f, saving: true, error: null } : f));
        const draft: ReportDraft = {
            extensionId: subjectId,
            tested: true,
            verificationDurationSecs: (Date.now() - form.verificationStart) / 1000,
            installs: form.installs,
            worksInMv2: form.worksInMv2,
            needsLogin: form.needsLogin,
            // A capability the manifest does not declare is null, never false: it was not tested.
            isPopupWorking: flags.hasPopup ? form.isPopupWorking : null,
            isSettingsWorking: flags.hasSettings ? form.isSettingsWorking : null,
            isNewTabWorking: flags.isNewTab ? form.isNewTabWorking : null,
            isInteresting: form.isInteresting,
            overallWorking: form.overallWorking,
            notes: form.notes,
            listeners: profile.listeners.map((l, i) => ({
                api: l.api,
                file: l.file,
                line: l.line,
                status: form.listenerStatus[i] ?? "untested",
            })),
        };
        void client
            .call<{ id: string }>("reports.submit", { report: draft })
            .then(async (res) => {
                // Straight on to the next extension; at the end of the corpus, stay put and show
                // the save confirmation rather than dropping the reviewer somewhere ambiguous.
                if (await onSubmitted()) {
                    setForm(null);
                } else {
                    setForm((f) => (f ? { ...f, saving: false, savedId: res.id } : f));
                    onExhausted();
                }
            })
            .catch((error: Error) => setForm((f) => (f ? { ...f, saving: false, error: error.message } : f)));
    }, [form, subjectId, profile, client, flags, onSubmitted, onExhausted]);

    return { form, rows, flags, open, close, move, cycle, toggleNotes, setNotes, submit };
}
