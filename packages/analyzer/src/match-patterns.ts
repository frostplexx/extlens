/**
 * Turning content-script match patterns into pages a reviewer can actually open.
 *
 * "Page interaction" is the surface reviewers get wrong most often, because the form asks whether
 * it works without saying where to look — and `https://*.example.com/*` is a pattern, not a page.
 * Converting it to `https://example.com/` turns a question into a link.
 *
 * The conversion is a best effort by design. A pattern describes a set; picking one member is a
 * guess, and a guess is useful ("try this page") in a way that a pattern is not. Where no member
 * can be guessed — `<all_urls>`, a bare `*` host — the answer is null rather than a fabricated
 * host, because sending a reviewer to a site the extension has nothing to do with is worse than
 * saying "any page".
 */

export interface ProbeUrl {
    /** The match pattern it came from, so the reviewer can see the guess is a guess. */
    pattern: string;
    /** A concrete page to open, or null when the pattern names no particular site. */
    url: string | null;
}

/** Chrome's match-pattern grammar: <scheme>://<host><path>, plus the <all_urls> special case. */
const PATTERN = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)?$/;

/**
 * One openable URL for a match pattern, or null when the pattern names no particular site.
 */
export function probeUrlFor(pattern: string): string | null {
    if (pattern === "<all_urls>") return null;

    const parts = PATTERN.exec(pattern);
    if (!parts) return null;
    const [, rawScheme, rawHost, rawPath = "/"] = parts;

    // `*` as a scheme means http or https; https is the one worth trying first.
    const scheme = rawScheme === "*" ? "https" : rawScheme;
    if (scheme === "file" || scheme === "ftp") return null;

    // A bare `*` host matches everything, so no single site represents it.
    if (rawHost === "*" || rawHost === "") return null;
    // `*.example.com` matches example.com and its subdomains; the bare domain is the fair guess.
    const host = rawHost.startsWith("*.") ? rawHost.slice(2) : rawHost;
    if (host.includes("*")) return null;

    // Trailing `/*` is "any path under here", which is the directory itself.
    const path = rawPath.endsWith("/*") ? rawPath.slice(0, -1) : rawPath === "/*" ? "/" : rawPath;
    // A `*` left inside the path cannot be resolved to one page; the host root still can.
    return `${scheme}://${host}${path.includes("*") ? "/" : path}`;
}

/**
 * Openable pages for a set of content scripts, in manifest order and de-duplicated.
 *
 * Patterns that name no particular site are kept with a null url: the reviewer still needs to know
 * the extension claims to run everywhere, which is itself a thing to check.
 */
export function probeUrls(matches: string[]): ProbeUrl[] {
    const seenPattern = new Set<string>();
    const out: ProbeUrl[] = [];
    /** host+path of each kept url, so http and https variants of one site collapse. */
    const sites = new Map<string, number>();

    for (const pattern of matches) {
        if (seenPattern.has(pattern)) continue;
        seenPattern.add(pattern);

        const url = probeUrlFor(pattern);
        if (!url) {
            // `http://*/*`, `https://*/*` and `file://*/*` are three ways of saying "everywhere",
            // and listing them separately reads as three different things to check.
            if (!out.some((p) => p.url === null)) out.push({ pattern, url });
            continue;
        }

        // Most manifests list http:// and https:// forms of the same site; they are one page to
        // try, and https is the one to try.
        const site = url.replace(/^https?:\/\//, "");
        const existing = sites.get(site);
        if (existing === undefined) {
            sites.set(site, out.length);
            out.push({ pattern, url });
        } else if (url.startsWith("https://") && !out[existing].url?.startsWith("https://")) {
            out[existing] = { pattern, url };
        }
    }
    return out;
}
