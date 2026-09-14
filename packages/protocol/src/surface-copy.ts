/**
 * Reviewer-facing wording for each surface: what it is called, and what to actually check.
 *
 * This lives in the protocol next to the surface enum rather than in a client because two
 * reviewers using two front ends have to be answering the same question. "Page interaction" is
 * the clearest case — without a hint it is not obvious that it means "go to a page the content
 * script matches and see whether its injected behaviour still happens", and a reviewer who guesses
 * differently from the next one silently makes the column unusable.
 *
 * Hints are instructions, not descriptions: they say what to do and what should happen.
 */
import type { UiSurface } from "./types.js";

export const SURFACE_LABELS: Record<UiSurface, string> = {
    popup: "Popup window",
    toolbar_action: "Toolbar button",
    options_page: "Settings page",
    new_tab: "Custom new tab",
    side_panel: "Side panel",
    devtools: "DevTools panel",
    context_menu: "Context menu",
    notifications: "Notifications",
    keyboard_shortcuts: "Keyboard shortcuts",
    omnibox: "Omnibox keyword",
    page_interaction: "Page interaction",
    background: "Survives idle",
};

export const SURFACE_HINTS: Record<UiSurface, string> = {
    popup: "Click the toolbar icon. The popup should open and render its content — not flash blank or show an error.",
    toolbar_action: "Click the toolbar icon. Something should happen: a tab opens, a badge changes, the page reacts.",
    options_page:
        "chrome://extensions → Details → Extension options. Settings should load, change, and survive a reload.",
    new_tab: "Open a new tab. The extension's page should replace Chrome's, and its content should work.",
    side_panel: "Open the side panel from the toolbar or menu. It should render and respond.",
    devtools: "Open DevTools (F12). The extension's panel should appear alongside Elements/Console.",
    context_menu:
        "Right-click a page, a selection, or a link. The extension's entry should appear and do what it says.",
    notifications: "Trigger whatever the extension notifies about. A system notification should appear.",
    keyboard_shortcuts:
        "Press the shortcut (chrome://extensions/shortcuts lists it). The bound command should run.",
    omnibox: "Type the keyword in the address bar, press Tab, then a query. Suggestions should appear.",
    page_interaction:
        "Visit a page the content script matches. Its injected UI or behaviour — buttons, highlights, replacements, blocking — should still happen.",
    // Was "exercise a feature that needs the background", which is not a question a reviewer can
    // answer: the background is not a thing you can look at. The MV3-specific failure is concrete
    // and reproducible, so ask for that instead — and it reuses a surface already judged above
    // rather than requiring anything new to be found.
    background:
        "Use a surface above, wait ~30s without touching that browser, then use it again. MV3 stops the service worker when idle, and anything it kept only in memory is gone.",
};
