/**
 * Two answers settle the whole form.
 *
 * If the extension does not install, nothing below it can work; if it needs an account nobody has,
 * nothing below it can be tested. Making the reviewer then set every surface by hand is busywork
 * whose outcome was already decided — and busywork at the exact moment the extension turns out to
 * be worthless to review, which is when patience is thinnest and a half-filled form is likeliest.
 *
 * So the answer propagates, and the reviewer goes straight to Save & next.
 *
 * It is reversible on purpose. The propagation overwrites judgements that may have been made
 * carefully, so a mis-click must not cost them: the statuses are snapshotted before the first
 * propagation and restored when the condition is lifted.
 */
import type { SurfaceResult } from "@extlens/protocol";

export interface QuickAssessment {
    installs: boolean;
    needsLogin: boolean;
}

export interface Propagation {
    surfaces: SurfaceResult[];
    /** Statuses as they were before the first propagation, or null when none is in effect. */
    snapshot: SurfaceResult[] | null;
    /** What to tell the reviewer, or null when nothing was propagated. */
    because: string | null;
}

/**
 * "Does not install" beats "needs an account": both make the surfaces unjudgeable, but a broken
 * install is a fact about the migration while a missing account is a fact about the harness, and
 * the more specific claim is the one worth recording.
 */
function ruleFor(assessment: QuickAssessment): { status: SurfaceResult["status"]; reason: string } | null {
    if (!assessment.installs) return { status: "broken", reason: "does not install" };
    if (assessment.needsLogin) return { status: "not_testable", reason: "needs an account" };
    return null;
}

export function propagate(
    surfaces: SurfaceResult[],
    assessment: QuickAssessment,
    snapshot: SurfaceResult[] | null,
): Propagation {
    const rule = ruleFor(assessment);

    if (!rule) {
        // Condition lifted: give the reviewer back exactly what they had judged.
        return snapshot ? { surfaces: snapshot, snapshot: null, because: null } : { surfaces, snapshot: null, because: null };
    }

    // Snapshot once. Re-snapshotting on a later toggle would capture the propagated values and
    // make the undo a no-op.
    const kept = snapshot ?? surfaces;
    return {
        surfaces: surfaces.map((s) => ({
            ...s,
            status: rule.status,
            // An existing note is the reviewer's own words and outranks ours.
            note: s.note || rule.reason,
        })),
        snapshot: kept,
        because:
            rule.status === "broken"
                ? "Every surface marked broken — the extension does not install."
                : "Every surface marked can’t test — the extension needs an account.",
    };
}
