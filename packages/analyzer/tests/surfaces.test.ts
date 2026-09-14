/**
 * Surface detection decides which questions a reviewer is asked, so the bias is deliberate: a
 * false positive costs one "not testable" row, a false negative loses the observation entirely.
 */
import { describe, expect, it } from "vitest";
import { detectSurfaces, listenersBySurface, surfaceForListener } from "../src/surfaces.js";
import type { Manifest, SourceFile } from "../src/types.js";

const js = (path: string, content: string): SourceFile => ({ path, type: "js", content });

function surfaces(manifest: Manifest, files: SourceFile[] = []): string[] {
    return detectSurfaces(manifest, files).map((s) => s.surface);
}

describe("manifest-declared surfaces", () => {
    it("finds the three the old form knew about", () => {
        expect(
            surfaces({
                action: { default_popup: "popup.html" },
                options_page: "options.html",
                chrome_url_overrides: { newtab: "newtab.html" },
            } as Manifest),
        ).toEqual(["popup", "options_page", "new_tab"]);
    });

    it("reads an MV2 browser_action popup as a popup", () => {
        expect(surfaces({ browser_action: { default_popup: "popup.html" } } as Manifest)).toEqual(["popup"]);
    });

    it("reads options_ui.page as an options page", () => {
        expect(surfaces({ options_ui: { page: "settings.html" } } as Manifest)).toEqual(["options_page"]);
    });

    it("finds side panel, devtools and omnibox", () => {
        const found = surfaces({
            side_panel: { default_path: "panel.html" },
            devtools_page: "devtools.html",
            omnibox: { keyword: "ext" },
        } as Manifest);
        expect(found).toEqual(["side_panel", "devtools", "omnibox"]);
    });

    it("treats content scripts as page interaction", () => {
        expect(surfaces({ content_scripts: [{ matches: ["https://*/*"], js: ["cs.js"] }] } as Manifest)).toEqual([
            "page_interaction",
        ]);
    });
});

describe("keyboard shortcuts", () => {
    it("counts a custom command", () => {
        expect(surfaces({ commands: { "do-thing": { suggested_key: {} } } } as Manifest)).toContain(
            "keyboard_shortcuts",
        );
    });

    it("ignores _execute_action, which is just the popup's shortcut", () => {
        // Chrome handles it natively; the extension has no command handler to break.
        expect(surfaces({ commands: { _execute_action: { suggested_key: {} } } } as Manifest)).not.toContain(
            "keyboard_shortcuts",
        );
    });
});

describe("surfaces with no manifest key of their own", () => {
    it("finds a context menu from the permission or the call", () => {
        expect(surfaces({ permissions: ["contextMenus"] } as Manifest)).toContain("context_menu");
        expect(surfaces({} as Manifest, [js("bg.js", "chrome.contextMenus.create({id:'x'})")])).toContain(
            "context_menu",
        );
    });

    it("finds notifications from either API", () => {
        expect(surfaces({} as Manifest, [js("bg.js", "chrome.notifications.create({})")])).toContain("notifications");
        expect(surfaces({} as Manifest, [js("bg.js", "new Notification('hi')")])).toContain("notifications");
    });

    it("reports the evidence alongside the surface", () => {
        // The reviewer needs to know why they are being asked about a surface they cannot see.
        const [found] = detectSurfaces({ permissions: ["contextMenus"] } as Manifest, []);
        expect(found.evidence).toBe("permission: contextMenus");
    });

    it("keeps the manifest's evidence when the source also mentions the surface", () => {
        const [found] = detectSurfaces({ action: { default_popup: "p.html" } } as Manifest, []);
        expect(found.evidence).toContain("default_popup");
    });
});

describe("extensions with no UI", () => {
    it("reports only the background surface", () => {
        expect(surfaces({ background: { scripts: ["bg.js"] } } as Manifest)).toEqual(["background"]);
    });

    it("reports nothing for an empty manifest", () => {
        expect(surfaces({} as Manifest)).toEqual([]);
    });
});

describe("toolbar actions and runtime popups", () => {
    it("reports the toolbar button an action declares, popup or not", () => {
        // An extension whose entire UI is a toolbar button used to report no surfaces at all.
        expect(surfaces({ action: {} } as Manifest)).toEqual(["toolbar_action"]);
        expect(surfaces({ browser_action: { default_title: "Go" } } as Manifest)).toEqual(["toolbar_action"]);
    });

    it("does not also report a toolbar button when the action has a popup", () => {
        // Chrome fires onClicked only when no popup is set: one click, one thing to judge.
        expect(surfaces({ action: { default_popup: "popup.html" } } as Manifest)).toEqual(["popup"]);
    });

    it("drops the toolbar button even when onClicked appears in the source alongside a popup", () => {
        const found = surfaces({ action: { default_popup: "popup.html" } } as Manifest, [
            js("bg.js", "chrome.action.onClicked.addListener(() => {})"),
        ]);
        expect(found).toEqual(["popup"]);
    });

    it("finds a popup attached at runtime with setPopup", () => {
        // An extension that swaps its popup per tab has no default_popup in the manifest at all.
        expect(surfaces({} as Manifest, [js("bg.js", "chrome.action.setPopup({popup:'a.html'})")])).toContain("popup");
        expect(surfaces({} as Manifest, [js("bg.js", "chrome.browserAction.setPopup({popup:'a.html'})")])).toContain(
            "popup",
        );
    });

    it("finds a click-only toolbar button from its listener", () => {
        expect(surfaces({} as Manifest, [js("bg.js", "chrome.action.onClicked.addListener(() => {})")])).toContain(
            "toolbar_action",
        );
    });

    it("keeps the manifest's evidence for a declared popup", () => {
        const [found] = detectSurfaces({ browser_action: { default_popup: "p.html" } } as Manifest, []);
        expect(found.evidence).toBe("browser_action.default_popup: p.html");
    });
});

describe("listeners as evidence about a surface", () => {
    it("routes a listener to the surface a reviewer can actually see", () => {
        // You cannot watch contextMenus.onClicked fire; you can watch the menu entry do something.
        expect(surfaceForListener("chrome.contextMenus.onClicked")).toBe("context_menu");
        expect(surfaceForListener("chrome.action.onClicked")).toBe("toolbar_action");
        expect(surfaceForListener("chrome.commands.onCommand")).toBe("keyboard_shortcuts");
        expect(surfaceForListener("chrome.notifications.onClicked")).toBe("notifications");
    });

    it("treats plumbing listeners as background behaviour", () => {
        expect(surfaceForListener("chrome.runtime.onMessage")).toBe("background");
        expect(surfaceForListener("chrome.tabs.onUpdated")).toBe("background");
        expect(surfaceForListener("chrome.webRequest.onBeforeRequest")).toBe("background");
    });

    it("returns null for an API that says nothing about the UI", () => {
        expect(surfaceForListener("chrome.i18n.getMessage")).toBeNull();
    });

    it("groups listeners under their surface, keeping order", () => {
        const grouped = listenersBySurface([
            { api: "chrome.runtime.onMessage" },
            { api: "chrome.contextMenus.onClicked" },
            { api: "chrome.tabs.onUpdated" },
        ]);
        expect(grouped.get("background")?.map((l) => l.api)).toEqual([
            "chrome.runtime.onMessage",
            "chrome.tabs.onUpdated",
        ]);
        expect(grouped.get("context_menu")?.map((l) => l.api)).toEqual(["chrome.contextMenus.onClicked"]);
    });
});

describe("routing the newly detected calls to a surface", () => {
    it("sends a created context menu to the context menu surface", () => {
        expect(surfaceForListener("chrome.contextMenus.create")).toBe("context_menu");
    });

    it("sends a badge to the toolbar button, which is where it appears", () => {
        expect(surfaceForListener("chrome.action.setBadgeText")).toBe("toolbar_action");
        expect(surfaceForListener("chrome.browserAction.setBadgeText")).toBe("toolbar_action");
    });

    it("sends a runtime setPopup to the popup rather than the button", () => {
        expect(surfaceForListener("chrome.action.setPopup")).toBe("popup");
    });

    it("sends injection APIs to page interaction", () => {
        expect(surfaceForListener("chrome.scripting.executeScript")).toBe("page_interaction");
        expect(surfaceForListener("chrome.tabs.executeScript")).toBe("page_interaction");
    });

    it("sends notifications and alarms where they belong", () => {
        expect(surfaceForListener("chrome.notifications.create")).toBe("notifications");
        expect(surfaceForListener("chrome.alarms.create")).toBe("background");
    });
});
