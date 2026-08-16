import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ReportDraftForm, TriState } from "../types.js";
import { Cursor } from "./ui.js";

/**
 * Manual test report form. Rows: tri-state booleans, a notes input, then one
 * row per listener. Owns its key handling; the app unmounts it when closed.
 * Row layout is shared with app.tsx via the exported constants.
 */

export const BOOLEAN_KEYS = [
  "tested",
  "overallWorking",
  "hasErrors",
  "seemsSlower",
  "needsLogin",
  "isPopupBroken",
  "isSettingsBroken",
  "isInteresting",
] as const;

const BOOLEAN_LABELS: Record<(typeof BOOLEAN_KEYS)[number], string> = {
  tested: "tested",
  overallWorking: "overall working",
  hasErrors: "errors seen",
  seemsSlower: "seems slower",
  needsLogin: "needs login",
  isPopupBroken: "popup broken",
  isSettingsBroken: "settings broken",
  isInteresting: "interesting",
};

export const NOTE_ROW_INDEX = BOOLEAN_KEYS.length;
export const LISTENER_START = NOTE_ROW_INDEX + 1;

function triLabel(value: TriState): string {
  if (value === null) return "-";
  return value ? "yes" : "no";
}

export function ReportForm({
  form,
  onCycle,
  onMove,
  onToggleNotes,
  onNotesChange,
  onSubmit,
  onCancel,
  listenerApis,
}: {
  form: ReportDraftForm;
  onCycle: (delta: 1 | -1) => void;
  onMove: (delta: 1 | -1) => void;
  onToggleNotes: () => void;
  onNotesChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  listenerApis: { api: string; file: string }[];
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
      if (form.cursor === NOTE_ROW_INDEX) onToggleNotes();
      return;
    }
    if (key.upArrow || key.downArrow) {
      onMove(key.upArrow ? -1 : 1);
      return;
    }
    if (key.leftArrow || key.rightArrow || input === " ") {
      onCycle(input === " " ? 1 : key.leftArrow ? -1 : 1);
      return;
    }
    if (input === "s" || input === "S") onSubmit();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>
        <Text bold>manual test report</Text>
        <Text dimColor> — {form.saving ? "saving…" : form.savedId ? `saved as ${form.savedId}` : "unsaved"}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {BOOLEAN_KEYS.map((field, i) => {
          const focused = i === form.cursor;
          return (
            <Text key={field}>
              <Cursor selected={focused} />
              <Text dimColor>{BOOLEAN_LABELS[field].padEnd(18)}</Text>
              <Text color={focused ? "cyan" : undefined} bold={focused}>
                {triLabel(form[field]).padEnd(4)}
              </Text>
              {focused ? <Text dimColor>← space/←/→ cycle</Text> : null}
            </Text>
          );
        })}

        <Text>
          <Cursor selected={form.cursor === NOTE_ROW_INDEX} />
          <Text dimColor>{"notes".padEnd(18)}</Text>
          {form.notesFocused ? (
            <Text color="cyan">{notesDraft}▌</Text>
          ) : (
            <Text color={form.cursor === NOTE_ROW_INDEX ? "cyan" : undefined}>
              {form.notes || "—"}
            </Text>
          )}
          {form.cursor === NOTE_ROW_INDEX && !form.notesFocused ? (
            <Text dimColor>  enter to edit</Text>
          ) : null}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"─".repeat(28)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          listeners
        </Text>
        {listenerApis.map((l, i) => {
          const row = LISTENER_START + i;
          const status = form.listenerStatus[i] ?? "untested";
          const focused = row === form.cursor;
          return (
            <Text key={`${l.api}:${l.file}`}>
              <Cursor selected={focused} />
              <Text dimColor>{String(i + 1).padStart(2)}) </Text>
              <Text>{l.api}</Text>
              <Text dimColor> {l.file}</Text>
              <Text>  </Text>
              <Text color={focused ? "cyan" : undefined} bold={focused}>
                {status}
              </Text>
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {form.saving ? (
          <Text dimColor>saving…</Text>
        ) : form.savedId ? (
          <Text color="green">saved as {form.savedId} — esc to close</Text>
        ) : (
          <Text dimColor>s submit · esc cancel · ↑/↓ move · space/←/→ cycle (− → yes → no)</Text>
        )}
        {form.error ? <Text color="red">  {form.error}</Text> : null}
      </Box>
    </Box>
  );
}
