/**
 * Monaco, bundled and themed for this page.
 *
 * Imported once, by the code view, and only there: this module pulls the editor into the bundle,
 * and browse/review mode should never pay for it. `@monaco-editor/react` would otherwise fetch the
 * editor from a CDN at runtime; this server is the only origin the page may talk to, so the editor
 * is bundled and handed to the loader instead.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

export const THEME = "catppuccin-mocha";

self.MonacoEnvironment = {
    getWorker(_id: string, label: string): Worker {
        switch (label) {
            case "json":
                return new JsonWorker();
            case "css":
            case "scss":
            case "less":
                return new CssWorker();
            case "html":
            case "handlebars":
            case "razor":
                return new HtmlWorker();
            case "typescript":
            case "javascript":
                return new TsWorker();
            default:
                return new EditorWorker();
        }
    },
};

loader.config({ monaco });

/*
 * Diagnostics off. The code on screen is other people's — usually minified, often bundled — and
 * a wall of red squiggles under a webpack chunk tells the reviewer nothing except that the file is
 * a webpack chunk. Manifests likewise: some carry comments, which is not the reviewer's problem.
 */
for (const defaults of [monaco.typescript.javascriptDefaults, monaco.typescript.typescriptDefaults]) {
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
}
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });

/* Catppuccin Mocha, the same palette as src/index.css, so the editor reads as part of the page. */
monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
        { token: "", foreground: "cdd6f4" },
        { token: "comment", foreground: "6c7086", fontStyle: "italic" },
        { token: "keyword", foreground: "cba6f7" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "fab387" },
        { token: "regexp", foreground: "f5c2e7" },
        { token: "type", foreground: "f9e2af" },
        { token: "type.identifier", foreground: "f9e2af" },
        { token: "identifier", foreground: "cdd6f4" },
        { token: "delimiter", foreground: "9399b2" },
        { token: "operator", foreground: "89dceb" },
        { token: "tag", foreground: "89b4fa" },
        { token: "attribute.name", foreground: "f9e2af" },
        { token: "attribute.value", foreground: "a6e3a1" },
        { token: "string.key.json", foreground: "89b4fa" },
        { token: "string.value.json", foreground: "a6e3a1" },
    ],
    colors: {
        "editor.background": "#1e1e2e",
        "editor.foreground": "#cdd6f4",
        "editor.lineHighlightBackground": "#313244",
        "editor.selectionBackground": "#45475a",
        "editor.inactiveSelectionBackground": "#313244",
        "editorLineNumber.foreground": "#6c7086",
        "editorLineNumber.activeForeground": "#a6adc8",
        "editorGutter.background": "#181825",
        "editorCursor.foreground": "#cba6f7",
        "editorIndentGuide.background": "#313244",
        "editorWidget.background": "#181825",
        "editorWidget.border": "#313244",
        "input.background": "#11111b",
        "diffEditor.insertedTextBackground": "#a6e3a133",
        "diffEditor.removedTextBackground": "#f38ba833",
        "diffEditor.insertedLineBackground": "#a6e3a11a",
        "diffEditor.removedLineBackground": "#f38ba81a",
        "scrollbarSlider.background": "#45475a80",
        "scrollbarSlider.hoverBackground": "#585b70a0",
    },
});

/** Monaco language id from a file's extension. Anything unknown is shown as plain text. */
export function languageFor(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    switch (ext) {
        case "js":
        case "mjs":
        case "cjs":
        case "jsx":
            return "javascript";
        case "ts":
        case "tsx":
            return "typescript";
        case "json":
            return "json";
        case "html":
        case "htm":
            return "html";
        case "css":
            return "css";
        case "md":
            return "markdown";
        case "xml":
        case "svg":
            return "xml";
        default:
            return "plaintext";
    }
}

export { monaco };
