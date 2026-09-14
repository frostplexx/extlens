/**
 * Surface detection decides which questions a reviewer is asked, so the bias is deliberate: a
 * false positive costs one "not testable" row, a false negative loses the observation entirely.
 */
import { describe, expect, it } from "vitest";
import { detectSurfaces } from "../src/surfaces.js";
import type { Manifest, SourceFile } from "../src/types.js";

const js = (path: string, content: string): SourceFile => ({ path, type: "js", content, sizeBytes: content.length });

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
