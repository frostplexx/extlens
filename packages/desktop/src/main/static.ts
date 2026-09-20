/**
 * The built renderer, served on its own scheme.
 *
 * `app://` rather than `file://`: a standard scheme gives the page a real origin, so module
 * scripts, workers and fonts load by the same rules they would from a web server, and the
 * renderer never has file-system reach. Two rules:
 * nothing outside the renderer's dist, and unknown paths fall back to index.html because the UI
 * is a single page.
 */
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

export const SCHEME = "app";
export const ORIGIN = `${SCHEME}://extlens`;

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    // Monaco's icon font (codicon.ttf) — without a font type the browser refuses to apply it.
    ".ttf": "font/ttf",
};

/**
 * What the page may load and talk to. Everything is bundled, so the answer is "itself" — plus
 * inline styles and blob workers, which Monaco needs, and data: fonts, which the icon set is.
 */
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
].join("; ");

export interface DistFile {
    path: string;
    type: string;
}

/** The file for a URL path, or null when the renderer has not been built at all. */
export function resolveDistFile(urlPath: string, dist: string): DistFile | null {
    const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, rel);
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
        return { path: file, type: MIME[extname(file)] ?? "application/octet-stream" };
    }
    const index = join(dist, "index.html");
    return existsSync(index) ? { path: index, type: MIME[".html"] } : null;
}

/** Answer one `app://` request from the renderer's dist. */
export async function serve(request: Request, dist: string): Promise<Response> {
    const file = resolveDistFile(new URL(request.url).pathname, dist);
    if (!file) return new Response("renderer not built — run `npm run build --workspace packages/desktop`", { status: 503 });
    const headers: Record<string, string> = { "content-type": file.type };
    if (file.type.startsWith("text/html")) headers["content-security-policy"] = CSP;
    return new Response(await readFile(file.path), { headers });
}
