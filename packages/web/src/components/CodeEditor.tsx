/**
 * One file in Monaco: a single variant, or the MV2→MV3 diff side by side.
 *
 * Read-only on purpose. The corpus is the host's; a page that let you type into it would either
 * lie (edits going nowhere) or need a write path nobody asked for.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { THEME, languageFor } from "@/lib/monaco";
import type { BrowserLabel } from "../types";

export type CodeViewMode = "diff" | "mv2" | "mv3";

/** Where to put the cursor: a line, in the variant it was counted in, and a nonce so re-clicking the same line jumps again. */
export interface JumpTarget {
    line: number;
    /** The variant the line number refers to — the analyzer's, not necessarily the one on screen. */
    label: BrowserLabel;
    nonce: number;
}

const OPTIONS: MonacoEditor.IStandaloneEditorConstructionOptions = {
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    wordWrap: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 12,
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
    renderLineHighlight: "line",
    lineNumbersMinChars: 4,
    padding: { top: 8 },
    scrollbar: { alwaysConsumeMouseWheel: false },
};

const DIFF_OPTIONS: MonacoEditor.IDiffEditorConstructionOptions = {
    ...OPTIONS,
    renderSideBySide: true,
    renderOverviewRuler: false,
    ignoreTrimWhitespace: false,
};

/**
 * Scroll to and mark the jump line, once the editor has the content the line refers to.
 *
 * The editor mounts before the file arrives and a reveal on an empty model is a no-op that then
 * never repeats — so this keys on the content too, and on the nonce so the same listener clicked
 * twice scrolls back twice.
 */
function useJump(
    editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>,
    jump: JumpTarget | null,
    content: string | null,
) {
    const decorations = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || !jump || content === null) return;
        const line = Math.max(1, Math.min(jump.line, editor.getModel()?.getLineCount() ?? 1));
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        decorations.current?.clear();
        decorations.current = editor.createDecorationsCollection([
            {
                range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
                options: { isWholeLine: true, className: "code-jump-line" },
            },
        ]);
        editor.focus();
    }, [editorRef, jump, content]);
}

export function CodeEditor({
    mode,
    path,
    original,
    modified,
    jump,
}: {
    mode: CodeViewMode;
    path: string;
    /** MV2 content; the left side of a diff, or the whole thing in `mv2` mode. */
    original: string | null;
    /** MV3 content; the right side of a diff, or the whole thing in `mv3` mode. */
    modified: string | null;
    jump: JumpTarget | null;
}) {
    const language = languageFor(path);
    if (mode === "diff") {
        return <DiffPane key={path} language={language} original={original} modified={modified} jump={jump} />;
    }
    return (
        <SinglePane
            key={`${mode}:${path}`}
            language={language}
            content={mode === "mv2" ? original : modified}
            jump={jump}
        />
    );
}

function SinglePane({ language, content, jump }: { language: string; content: string | null; jump: JumpTarget | null }) {
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    useJump(editorRef, jump, content);
    return (
        <Editor
            value={content ?? ""}
            language={language}
            theme={THEME}
            options={OPTIONS}
            onMount={(editor) => {
                editorRef.current = editor;
            }}
            loading={null}
        />
    );
}

function DiffPane({
    language,
    original,
    modified,
    jump,
}: {
    language: string;
    original: string | null;
    modified: string | null;
    jump: JumpTarget | null;
}) {
    const diffRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
    // The jump lands on the side its line number was counted in; the other side is context.
    const sideRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const side = jump?.label ?? "mv3";
    useEffect(() => {
        sideRef.current = side === "mv2" ? (diffRef.current?.getOriginalEditor() ?? null) : (diffRef.current?.getModifiedEditor() ?? null);
    });
    useJump(sideRef, jump, side === "mv2" ? original : modified);

    /*
     * Models outlive the wrapper's cleanup on purpose. Left to itself it disposes both models and
     * only then the diff editor, which Monaco reports as an error on every file switch. Detaching
     * the models first and disposing them ourselves is the order it wants.
     */
    useEffect(
        () => () => {
            const diff = diffRef.current;
            const model = diff?.getModel();
            diff?.setModel(null);
            model?.original.dispose();
            model?.modified.dispose();
        },
        [],
    );

    return (
        <DiffEditor
            original={original ?? ""}
            modified={modified ?? ""}
            language={language}
            theme={THEME}
            options={DIFF_OPTIONS}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            onMount={(diff) => {
                diffRef.current = diff;
                sideRef.current = side === "mv2" ? diff.getOriginalEditor() : diff.getModifiedEditor();
            }}
            loading={null}
        />
    );
}
