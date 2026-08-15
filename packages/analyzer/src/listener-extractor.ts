import type { Listener, SourceFile } from "./types.js";

/**
 * Event listener inventory. Port of the v0 ExtPorter listener-extractor.
 * Matches chrome|browser *.on*.addListener calls, dedupes per api+file, and
 * records 1-indexed line numbers with a snippet. Files are filtered by
 * extension only; the source already represents one version (v0 split v2/v3
 * paths in the host layer).
 */

const LISTENER_REGEX = /(chrome|browser)\.(\w+)\.(\w+)\.addListener\s*\(/g;

function isJavaScriptFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ext === "js" || ext === "mjs" || ext === "cjs";
}

export function extractListeners(files: SourceFile[]): Listener[] {
  const listeners: Listener[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!isJavaScriptFile(file.path)) continue;
    const content = file.content;
    if (!content) continue;

    const lines = content.split("\n");
    LISTENER_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = LISTENER_REGEX.exec(content)) !== null) {
      const api = `${match[1]}.${match[2]}.${match[3]}`;

      const key = `${api}:${file.path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const lineNumber = content.substring(0, match.index).split("\n").length;
      const snippet = (lines[lineNumber - 1] || "").trim().substring(0, 100);

      listeners.push({ api, file: file.path, line: lineNumber, snippet });
    }
  }

  listeners.sort((a, b) => {
    if (a.api !== b.api) return a.api.localeCompare(b.api);
    return a.file.localeCompare(b.file);
  });

  return listeners;
}
