/**
 * Which user-facing surfaces an extension actually has.
 *
 * Manual validation used to ask about three things — popup, options page, new tab — because those
 * are the three the old form had. An extension whose entire UI is a context menu and a keyboard
 * shortcut scored the same as one with no UI at all, and a reviewer had nowhere to record that its
 * only feature was broken. That makes a per-surface result table impossible to build after the
 * fact, so detection has to happen here, from the manifest and the source.
 *
 * Detection is deliberately generous: a surface is listed when the extension *declares or uses*
 * it, and the reviewer decides whether it works. A false positive costs one "not testable"; a
 * false negative loses the observation entirely.
 */
import type { Manifest, SourceFile } from "./types.js";

/** The surfaces a reviewer can be asked about, in the order a review pass would meet them. */
export const UI_SURFACES = [
    "popup",
    "options_page",
    "new_tab",
    "side_panel",
    "devtools",
    "context_menu",
    "notifications",
    "keyboard_shortcuts",
    "omnibox",
    "page_interaction",
    "background",
] as const;

export type UiSurface = (typeof UI_SURFACES)[number];

/** Why we think the extension has this surface — shown to the reviewer as a hint. */
export interface DetectedSurface {
    surface: UiSurface;
    /** Manifest key or API call that gave it away. */
    evidence: string;
}

const API_PATTERNS: { surface: UiSurface; pattern: RegExp; evidence: string }[] = [
    { surface: "context_menu", pattern: /\b(chrome|browser)\.contextMenus\.create\s*\(/, evidence: "contextMenus.create()" },
    { surface: "notifications", pattern: /\b(chrome|browser)\.notifications\.create\s*\(/, evidence: "notifications.create()" },
    { surface: "keyboard_shortcuts", pattern: /\b(chrome|browser)\.commands\.onCommand\b/, evidence: "commands.onCommand" },
    { surface: "omnibox", pattern: /\b(chrome|browser)\.omnibox\b/, evidence: "omnibox API" },
    { surface: "side_panel", pattern: /\b(chrome|browser)\.sidePanel\b/, evidence: "sidePanel API" },
    { surface: "notifications", pattern: /new\s+Notification\s*\(/, evidence: "web Notification()" },
];

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Surfaces this extension exposes, with the evidence for each.
 *
 * Manifest declarations come first because they are certain; source patterns fill in the surfaces
 * that need no manifest key of their own (a context menu needs only the permission and a call).
 */
export function detectSurfaces(manifest: Manifest, files: SourceFile[]): DetectedSurface[] {
    const found = new Map<UiSurface, string>();
    const add = (surface: UiSurface, evidence: string): void => {
        if (!found.has(surface)) found.set(surface, evidence);
    };

    const action = asRecord(manifest.action ?? manifest.browser_action ?? manifest.page_action);
    const popup = stringOrNull(action.default_popup);
    if (popup) add("popup", `action.default_popup: ${popup}`);

    const optionsUi = asRecord(manifest.options_ui);
    const optionsPage = stringOrNull(manifest.options_page) ?? stringOrNull(optionsUi.page);
    if (optionsPage) add("options_page", `options page: ${optionsPage}`);

    const overrides = asRecord(manifest.chrome_url_overrides);
    const newtab = stringOrNull(overrides.newtab);
    if (newtab) add("new_tab", `chrome_url_overrides.newtab: ${newtab}`);

    const sidePanel = asRecord(manifest.side_panel);
    const sidePanelPath = stringOrNull(sidePanel.default_path);
    if (sidePanelPath) add("side_panel", `side_panel.default_path: ${sidePanelPath}`);

    const devtools = stringOrNull(manifest.devtools_page);
    if (devtools) add("devtools", `devtools_page: ${devtools}`);

    const omnibox = asRecord(manifest.omnibox);
    if (stringOrNull(omnibox.keyword)) add("omnibox", `omnibox.keyword: ${omnibox.keyword as string}`);

    const commands = asRecord(manifest.commands);
    // _execute_action is Chrome's built-in "open the popup" binding: it is the popup's shortcut,
    // not a separate command the extension has to handle, so it does not imply a keyboard surface.
    const custom = Object.keys(commands).filter((key) => !key.startsWith("_execute"));
    if (custom.length > 0) add("keyboard_shortcuts", `commands: ${custom.join(", ")}`);

    const permissions = Array.isArray(manifest.permissions) ? (manifest.permissions as unknown[]) : [];
    if (permissions.includes("contextMenus")) add("context_menu", "permission: contextMenus");
    if (permissions.includes("notifications")) add("notifications", "permission: notifications");

    const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    if (contentScripts.length > 0) {
        const matches = contentScripts
            .flatMap((cs) => (Array.isArray(asRecord(cs).matches) ? (asRecord(cs).matches as string[]) : []))
            .slice(0, 3);
        add("page_interaction", `content_scripts on ${matches.join(", ") || "declared pages"}`);
    }

    if (manifest.background) add("background", "background script");

    for (const file of files) {
        if (file.type !== "js" && file.type !== "html") continue;
        for (const { surface, pattern, evidence } of API_PATTERNS) {
            if (!found.has(surface) && pattern.test(file.content)) add(surface, `${file.path}: ${evidence}`);
        }
    }

    return UI_SURFACES.filter((surface) => found.has(surface)).map((surface) => ({
        surface,
        evidence: found.get(surface) as string,
    }));
}
