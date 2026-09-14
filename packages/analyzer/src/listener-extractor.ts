import type { Listener, SourceFile } from "./types.js";

/**
 * Inventory of the extension's events and the user-facing things it creates.
 *
 * Originally this matched exactly `chrome.<ns>.<event>.addListener(` in `.js` files, which is a
 * narrower question than the one a reviewer is actually asking. Three gaps mattered:
 *
 *   - Not every user-facing feature arrives through addListener. A right-click entry comes from
 *     `contextMenus.create`, a notification from `notifications.create`, a badge from
 *     `action.setBadgeText`. Those are the things a reviewer has to go and look for, and none of
 *     them were listed.
 *   - Namespaces nest: `chrome.devtools.network.onRequestFinished` never matched, and neither did
 *     the `addRules` registrations used by declarativeContent.
 *   - Popup and options logic often lives in an inline `<script>` in the HTML, which was skipped
 *     entirely, so an extension whose whole UI is a popup could report no events at all.
 *
 * Entries are tagged `listener` (it reacts to something) or `call` (it creates something), because
 * the two mean different things to a reviewer: one is "trigger this", the other is "look for this".
 */

/** `chrome.ns.onEvent.addListener(` and `chrome.ns.sub.onEvent.addRules(` — one or two namespaces. */
const EVENT_REGEX = /\b(chrome|browser)\.((?:\w+\.){1,2})(on[A-Z]\w*)\.(addListener|addRules)\s*\(/g;

/**
 * Calls that put something in front of the user.
 *
 * Deliberately not every API call: this list is what a reviewer would otherwise have to discover by
 * clicking around — a menu entry, a notification, a badge, a spoken phrase, a downloaded file.
 */
const CREATOR_REGEX =
    /\b(chrome|browser)\.(contextMenus\.(?:create|update)|notifications\.create|action\.set(?:BadgeText|Title|Icon|Popup)|browserAction\.set(?:BadgeText|Title|Icon|Popup)|pageAction\.(?:show|setPopup)|alarms\.create|omnibox\.setDefaultSuggestion|sidePanel\.(?:setOptions|open)|downloads\.download|tts\.speak|offscreen\.createDocument|declarativeNetRequest\.update\w*Rules|scripting\.(?:executeScript|insertCSS)|tabs\.(?:create|executeScript))\s*\(/g;

function isJavaScriptFile(path: string): boolean {
    const ext = path.toLowerCase().split(".").pop() || "";
    return ext === "js" || ext === "mjs" || ext === "cjs";
}

function isHtmlFile(path: string): boolean {
    const ext = path.toLowerCase().split(".").pop() || "";
    return ext === "html" || ext === "htm";
}

/** 1-indexed line of an offset, and the trimmed source line, capped so a minified line cannot flood. */
function locate(content: string, index: number, lines: string[]): { line: number; snippet: string } {
    const line = content.slice(0, index).split("\n").length;
    return { line, snippet: (lines[line - 1] || "").trim().slice(0, 100) };
}

function scan(
    file: SourceFile,
    regex: RegExp,
    apiOf: (match: RegExpExecArray) => string,
    kind: "listener" | "call",
    seen: Set<string>,
    out: Listener[],
): void {
    const lines = file.content.split("\n");
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(file.content)) !== null) {
        const api = apiOf(match);
        // One entry per api per file: a loop registering the same handler twenty times is one fact.
        const key = `${api}:${file.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { line, snippet } = locate(file.content, match.index, lines);
        out.push({ api, file: file.path, line, snippet, kind });
    }
}

export function extractListeners(files: SourceFile[]): Listener[] {
    const listeners: Listener[] = [];
    const seen = new Set<string>();

    for (const file of files) {
        // HTML is included for its inline scripts; a popup's entire behaviour is often in one.
        if (!isJavaScriptFile(file.path) && !isHtmlFile(file.path)) continue;
        if (!file.content) continue;

        scan(
            file,
            EVENT_REGEX,
            // match[2] is "ns." or "ns.sub.", already dot-terminated.
            (m) => `${m[1]}.${m[2]}${m[3]}`,
            "listener",
            seen,
            listeners,
        );
        scan(file, CREATOR_REGEX, (m) => `${m[1]}.${m[2]}`, "call", seen, listeners);
    }

    listeners.sort((a, b) => {
        if (a.api !== b.api) return a.api.localeCompare(b.api);
        return a.file.localeCompare(b.file);
    });

    return listeners;
}
