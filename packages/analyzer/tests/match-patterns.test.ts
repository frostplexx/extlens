/**
 * A match pattern describes a set of pages; a reviewer needs one page. Picking a member is a
 * guess, so these tests pin where guessing is fair and where it is better to say "any page".
 */
import { describe, expect, it } from "vitest";
import { probeUrlFor, probeUrls } from "../src/match-patterns.js";

describe("one openable page per pattern", () => {
    it("uses the bare domain for a subdomain wildcard", () => {
        expect(probeUrlFor("https://*.github.com/*")).toBe("https://github.com/");
    });

    it("keeps a concrete host and path", () => {
        expect(probeUrlFor("https://mail.google.com/mail/*")).toBe("https://mail.google.com/mail/");
        expect(probeUrlFor("https://example.com/exact.html")).toBe("https://example.com/exact.html");
    });

    it("reads a wildcard scheme as https", () => {
        expect(probeUrlFor("*://example.com/*")).toBe("https://example.com/");
    });

    it("falls back to the host root when a wildcard sits inside the path", () => {
        expect(probeUrlFor("https://example.com/a/*/b")).toBe("https://example.com/");
    });
});

describe("patterns that name no particular site", () => {
    it("returns null rather than inventing a host", () => {
        // Sending a reviewer to a site the extension has nothing to do with is worse than
        // saying "any page".
        expect(probeUrlFor("<all_urls>")).toBeNull();
        expect(probeUrlFor("*://*/*")).toBeNull();
        expect(probeUrlFor("https://*/*")).toBeNull();
    });

    it("returns null for schemes a reviewer cannot just open", () => {
        expect(probeUrlFor("file:///*")).toBeNull();
        expect(probeUrlFor("ftp://example.com/*")).toBeNull();
    });

    it("returns null for a pattern it cannot parse", () => {
        expect(probeUrlFor("not a pattern")).toBeNull();
        expect(probeUrlFor("")).toBeNull();
    });
});

describe("a content script's pattern set", () => {
    it("keeps manifest order and drops duplicate patterns", () => {
        expect(probeUrls(["https://a.com/*", "https://b.com/*", "https://a.com/*"]).map((p) => p.url)).toEqual([
            "https://a.com/",
            "https://b.com/",
        ]);
    });

    it("collapses http and https variants of the same site", () => {
        // Both appear in most manifests and resolve to the same page to try.
        expect(probeUrls(["http://*.x.com/*", "https://*.x.com/*"]).map((p) => p.url)).toEqual(["https://x.com/"]);
    });

    it("keeps an unresolvable pattern, because running everywhere is itself worth checking", () => {
        expect(probeUrls(["<all_urls>"])).toEqual([{ pattern: "<all_urls>", url: null }]);
    });

    it("states 'everywhere' once, however many ways the manifest says it", () => {
        // http://*/*, https://*/* and file://*/* are one thing to check, not three.
        expect(probeUrls(["http://*/*", "https://*/*", "file://*/*"])).toEqual([
            { pattern: "http://*/*", url: null },
        ]);
    });

    it("still lists a concrete site alongside an everywhere pattern", () => {
        expect(probeUrls(["<all_urls>", "https://*.github.com/*"]).map((p) => p.url)).toEqual([
            null,
            "https://github.com/",
        ]);
    });
});
