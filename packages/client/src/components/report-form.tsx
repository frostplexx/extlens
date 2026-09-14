import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { DetectedSurface, SurfaceStatus, UiSurface } from "@extlens/protocol";
import { SURFACE_HINTS, SURFACE_LABELS } from "@extlens/protocol";
import type { ReportDraftForm } from "../types.js";
import { c } from "../theme.js";
import { Cursor } from "./ui.js";

/**
 * Manual test report form, matching the ExtPorter report form field set:
 * listeners first, then Installs, Works in MV2, Needs Login, the conditional
 * Popup / Settings / New Tab fields, Is Interesting, Overall Working, Notes,
 * and Submit. Conditional rows appear only when the manifest declares them.
 */

export type BooleanField =
  | "installs"
  | "worksInMv2"
  | "needsLogin"
  | "isPopupWorking"
  | "isSettingsWorking"
  | "isNewTabWorking"
  | "isInteresting";

export type FormRow =
  | { kind: "boolean"; field: BooleanField }
  | { kind: "overall" }
  | { kind: "notes" }
  | { kind: "submit" }
  | { kind: "listener"; index: number }
  | { kind: "surface"; surface: UiSurface };

/**
 * Visible row order: the surfaces this extension exposes, then the quick assessment.
 *
 * Listeners are no longer rows. A reviewer cannot watch `chrome.contextMenus.onClicked` fire —
 * only the menu entry doing something — so a listener is evidence about a surface, not a thing to
 * judge, and it is shown under the surface it exercises instead. The overall verdict is likewise
 * gone: it is computed from the surface results (protocol/verdict.ts) rather than asked for.
 */
export function buildReportRows(opts: {
  hasPopup: boolean;
  hasSettings: boolean;
  isNewTab: boolean;
  listenerCount: number;
  /** Surfaces detected in the source; one row each, replacing the fixed popup/settings/newtab set. */
  surfaces?: DetectedSurface[];
}): FormRow[] {
  const rows: FormRow[] = [];
  const surfaces = opts.surfaces ?? [];
  for (const { surface } of surfaces) rows.push({ kind: "surface", surface });
  rows.push({ kind: "boolean", field: "installs" });
  rows.push({ kind: "boolean", field: "worksInMv2" });
  rows.push({ kind: "boolean", field: "needsLogin" });
  // The three legacy per-surface booleans only appear for a host that reports no surfaces at all,
  // so an older host keeps a usable form instead of one with nothing to judge.
  if (surfaces.length === 0) {
    if (opts.hasPopup) rows.push({ kind: "boolean", field: "isPopupWorking" });
    if (opts.hasSettings) rows.push({ kind: "boolean", field: "isSettingsWorking" });
    if (opts.isNewTab) rows.push({ kind: "boolean", field: "isNewTabWorking" });
  }
  rows.push({ kind: "boolean", field: "isInteresting" });
  rows.push({ kind: "notes" });
  rows.push({ kind: "submit" });
  return rows;
}

/** The cycle a surface row steps through, in the order a reviewer most often needs. */
export const SURFACE_CYCLE: SurfaceStatus[] = ["untested", "working", "partial", "broken", "not_testable"];

const SURFACE_STATUS_LABELS: Record<SurfaceStatus, string> = {
  untested: "untested",
  working: "works",
  partial: "partly works",
  broken: "broken",
  not_testable: "can't test",
};

const SURFACE_STATUS_COLORS: Record<SurfaceStatus, string | undefined> = {
  untested: c.muted,
  working: c.success,
  partial: c.warning,
  broken: c.danger,
  not_testable: c.info,
};

const BOOLEAN_LABELS: Record<BooleanField, string> = {
  installs: "Installs",
  worksInMv2: "Works in MV2",
  needsLogin: "Needs Login",
  isPopupWorking: "Is Popup Working",
  isSettingsWorking: "Is Settings Working",
  isNewTabWorking: "Is New Tab Working",
  isInteresting: "Is Interesting",
};

const OVERALL_LABELS: Record<"yes" | "no" | "could_not_test", string> = {
  yes: "Yes",
  no: "No",
  could_not_test: "Could not test",
};

const LISTENER_STATUS_LABELS: Record<"untested" | "yes" | "no", string> = {
  yes: "works",
  no: "doesn't work",
  untested: "untested",
};

/** Auto-collected header data (extension ids and verification timing). */
export interface ReportAutoInfo {
  name: string;
  mv2Id: string | null;
  mv3Id: string | null;
  elapsedSecs: number | null;
}

export function ReportForm({
  form,
  rows,
  auto,
  onCycle,
  onMove,
  onToggleNotes,
  onNotesChange,
  onSubmit,
  onCancel,
  listenerApis,
  surfaceEvidence,
}: {
  form: ReportDraftForm;
  rows: FormRow[];
  auto: ReportAutoInfo;
  onCycle: (delta: 1 | -1) => void;
  onMove: (delta: 1 | -1) => void;
  onToggleNotes: () => void;
  onNotesChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  listenerApis: { api: string; file: string }[];
  /** Why each surface was detected, shown on the focused row so the question makes sense. */
  surfaceEvidence?: Partial<Record<UiSurface, string>>;
}) {
  const [notesDraft, setNotesDraft] = useState(form.notes);

  useInput((input, key) => {
    if (form.saving) return;

    if (form.notesFocused) {
      if (key.escape || (key.return && input === "")) {
        onNotesChange(notesDraft);
        onToggleNotes();
        return;
      }
      if (key.ctrl && input === "u") {
        setNotesDraft("");
        return;
      }
      if (key.backspace || key.delete) {
        setNotesDraft(notesDraft.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setNotesDraft(notesDraft + input);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const row = rows[form.cursor];
      if (row?.kind === "notes") onToggleNotes();
      else if (row?.kind === "submit") onSubmit();
      return;
    }
    if (key.upArrow || input === "k") {
      onMove(-1);
      return;
    }
    if (key.downArrow || input === "j") {
      onMove(1);
      return;
    }
    if (key.leftArrow || key.rightArrow || input === " ") {
      onCycle(input === " " ? 1 : key.leftArrow ? -1 : 1);
      return;
    }
    if (input === "s" || input === "S") onSubmit();
  });

  const renderRow = (row: FormRow, i: number) => {
    const focused = i === form.cursor;
    if (row.kind === "listener") {
      const listener = listenerApis[row.index];
      const status = form.listenerStatus[row.index] ?? "untested";
      return (
        <Text key={`listener-${row.index}`}>
          <Cursor selected={focused} />
          <Text dimColor>{String(row.index + 1).padStart(2)}) </Text>
          <Text>{listener?.api ?? "?"}</Text>
          <Text dimColor> {listener?.file ?? ""}</Text>
          <Text>  </Text>
          <Text color={focused ? c.accent : undefined} bold={focused}>
            {LISTENER_STATUS_LABELS[status]}
          </Text>
        </Text>
      );
    }
    if (row.kind === "surface") {
      const status = form.surfaceStatus[row.surface] ?? "untested";
      const evidence = surfaceEvidence?.[row.surface];
      // The hint is only worth its row for the surface being judged; every row carrying one
      // would double the form's height for guidance the reviewer has already read.
      const detail = focused ? (
        <Text key={`surface-${row.surface}-hint`} dimColor>
          {"  "}
          {SURFACE_HINTS[row.surface]}
          {evidence ? ` (from ${evidence})` : ""}
        </Text>
      ) : null;
      const line = (
        <Text key={`surface-${row.surface}`}>
          <Cursor selected={focused} />
          <Text dimColor>{SURFACE_LABELS[row.surface].padEnd(20)}</Text>
          <Text color={focused ? c.accent : SURFACE_STATUS_COLORS[status]} bold={focused}>
            {SURFACE_STATUS_LABELS[status]}
          </Text>
          {focused ? <Text dimColor>  space/←/→ cycle</Text> : null}
        </Text>
      );
      return detail ? (
        <React.Fragment key={`surface-${row.surface}-group`}>
          {line}
          {detail}
        </React.Fragment>
      ) : (
        line
      );
    }
    if (row.kind === "boolean") {
      return (
        <Text key={row.field}>
          <Cursor selected={focused} />
          <Text dimColor>{BOOLEAN_LABELS[row.field].padEnd(20)}</Text>
          <Text color={focused ? c.accent : undefined} bold={focused}>
            {form[row.field] ? "Yes" : "No"}
          </Text>
          {focused ? <Text dimColor>  space/←/→ toggle</Text> : null}
        </Text>
      );
    }
    if (row.kind === "overall") {
      return (
        <Text key="overall">
          <Cursor selected={focused} />
          <Text dimColor>{"Overall Working".padEnd(20)}</Text>
          <Text color={focused ? c.accent : undefined} bold={focused}>
            {OVERALL_LABELS[form.overallWorking]}
          </Text>
          {focused ? <Text dimColor>  space/←/→ cycle</Text> : null}
        </Text>
      );
    }
    if (row.kind === "notes") {
      return (
        <Text key="notes">
          <Cursor selected={focused} />
          <Text dimColor>{"Notes (optional)".padEnd(20)}</Text>
          {form.notesFocused ? (
            <Text color={c.accent}>{notesDraft}▌</Text>
          ) : (
            <Text color={focused ? c.accent : undefined}>{form.notes || "—"}</Text>
          )}
          {focused && !form.notesFocused ? <Text dimColor>  enter to edit</Text> : null}
        </Text>
      );
    }
    return (
      <Text key="submit">
        <Cursor selected={focused} />
        <Text color={focused ? c.success : undefined} bold={focused}>
          Submit
        </Text>
        <Text dimColor>  (enter)</Text>
      </Text>
    );
  };

  const { stdout } = useStdout();
  const termRows = stdout.rows ?? 24;
  const cols = stdout.columns ?? 80;
  const visible = Math.max(1, termRows - 6);
  // The header is 7 fixed rows; on a short terminal that alone overflows, so drop the blank
  // spacer and the rule when space is tight rather than pushing the frame off screen.
  const tight = termRows < 20;

  const header: React.ReactNode[] = [
    <Text key="h-title">
      <Text bold>manual test report</Text>
      <Text dimColor>
        {" "}
        — {form.saving ? "saving…" : form.savedId ? `saved as ${form.savedId}` : "unsaved"}
      </Text>
    </Text>,
    ...(tight ? [] : [<Text key="h-gap"> </Text>]),
    <Text key="h-name">
      <Text bold>Extension: </Text>
      {auto.name}
    </Text>,
    <Text key="h-mv2">
      <Text bold>MV2 ID: </Text>
      {auto.mv2Id ?? "N/A"}
    </Text>,
    <Text key="h-mv3">
      <Text bold>MV3 ID: </Text>
      {auto.mv3Id ?? "N/A"}
    </Text>,
    <Text key="h-time">
      <Text bold>Verification Time: </Text>
      {auto.elapsedSecs === null ? "not started" : `${auto.elapsedSecs.toFixed(1)}s`}
    </Text>,
    ...(tight
      ? []
      : [
          <Text key="h-rule" dimColor>
            {"─".repeat(Math.max(10, cols - 4))}
          </Text>,
        ]),
  ];

  const footer: React.ReactNode[] = [
    <Text key="f-status">
      {form.saving ? (
        <Text dimColor>saving…</Text>
      ) : form.savedId ? (
        <Text color={c.success}>saved as {form.savedId} — esc to close</Text>
      ) : (
        <Text dimColor>s submit · esc cancel · ↑/↓ j/k move · space/←/→ cycle</Text>
      )}
      {form.error ? <Text color={c.danger}>  {form.error}</Text> : null}
    </Text>,
  ];

  const body = rows.map(renderRow);
  const fixed = header.length + footer.length;
  // Floor of 1: a floor of 3 meant the form was always at least `fixed + 4` rows tall, which
  // overflowed any terminal shorter than about 18 rows.
  const available = Math.max(1, visible - fixed);
  const overflowing = body.length > available;
  const rowWindow = overflowing ? available - 1 : available;
  const focus = form.cursor;
  let start = Math.max(0, focus - Math.floor(rowWindow / 2));
  start = Math.min(start, Math.max(0, body.length - rowWindow));
  const shownBody = body.slice(start, start + rowWindow);

  return (
    <Box flexDirection="column">
      {header}
      {shownBody}
      {overflowing ? (
        <Text color={c.muted}>
          … {start + 1}-{start + rowWindow}/{body.length} form rows · ↑/↓ moves the cursor
        </Text>
      ) : null}
      {footer}
    </Box>
  );
}
