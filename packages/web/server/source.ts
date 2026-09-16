/**
 * Reading an extension's source for the code explorer.
 *
 * Everything here takes a directory the server already has — a local corpus path, or the ssh
 * download the browser launch uses — and is pure enough to test with temp dirs. The two questions
 * a reviewer asks are "what changed between MV2 and MV3?" and "show me this file", so that is the
 * whole surface: a tree with a status per path, and one file at a time.
 */
import { createHash } from "node:crypto";
import { lstatSync, openSync, readSync, closeSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

export type SourceStatus = "added" | "removed" | "modified" | "unchanged";

export interface SourceEntry {
    /** Forward-slash path relative to the extension root — the same shape as a listener's `file`. */
    path: string;
    status: SourceStatus;
    size: { mv2?: number; mv3?: number };
    binary: boolean;
}

export interface SourceTree {
    entries: SourceEntry[];
    /** True when a root had more files than the walk was willing to list. */
    truncated: boolean;
}

export interface SourceFile {
    content: string;
    truncated: boolean;
    binary: boolean;
}

/** More files than this and it is a node_modules that escaped the skip list, not an extension. */
export const MAX_ENTRIES = 5000;
/** Bundles bigger than this are not read by a person; the editor gets the head and a warning. */
export const MAX_SOURCE_FILE = 2 * 1024 * 1024;

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const BINARY_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".wasm", ".zip", ".crx", ".pdf", ".mp3", ".mp4", ".ogg", ".wav",
]);

interface Walked {
    files: Map<string, { abs: string; size: number }>;
    truncated: boolean;
}

/** Every regular file under `root`, keyed by relative forward-slash path. Symlinks are not followed. */
export function walkSource(root: string): Walked {
    const files = new Map<string, { abs: string; size: number }>();
    let truncated = false;
    const visit = (dir: string, rel: string): void => {
        if (truncated) return;
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            return;
        }
        for (const name of names.sort()) {
            if (files.size >= MAX_ENTRIES) {
                truncated = true;
                return;
            }
            const abs = join(dir, name);
            const relPath = rel ? `${rel}/${name}` : name;
            const stat = lstatSync(abs);
            if (stat.isDirectory()) {
                if (!SKIP_DIRS.has(name)) visit(abs, relPath);
            } else if (stat.isFile()) {
                files.set(relPath, { abs, size: stat.size });
            }
        }
    };
    visit(root, "");
    return { files, truncated };
}

/** A NUL in the first 8 KB, or an extension nobody opens in an editor. */
export function isBinary(path: string, head: Buffer): boolean {
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return true;
    return head.subarray(0, 8192).includes(0);
}

function readHead(abs: string, bytes = 8192): Buffer {
    const fd = openSync(abs, "r");
    try {
        const buf = Buffer.alloc(bytes);
        const n = readSync(fd, buf, 0, bytes, 0);
        return buf.subarray(0, n);
    } finally {
        closeSync(fd);
    }
}

function sha1(abs: string): string {
    return createHash("sha1").update(readFileSync(abs)).digest("hex");
}

/**
 * Union of both variants' files with a status per path.
 *
 * With one root there is nothing to compare against, so everything is `unchanged` and the client
 * shows a plain tree. Hashing only happens for a path in both roots whose sizes agree — a size
 * difference already answers the question, and most of a migration's files are either untouched
 * or visibly rewritten.
 */
export function diffSource(mv2Root?: string, mv3Root?: string): SourceTree {
    const mv2 = mv2Root ? walkSource(mv2Root) : null;
    const mv3 = mv3Root ? walkSource(mv3Root) : null;
    const paths = new Set<string>([...(mv2?.files.keys() ?? []), ...(mv3?.files.keys() ?? [])]);
    const both = Boolean(mv2 && mv3);
    const entries: SourceEntry[] = [];
    for (const path of [...paths].sort()) {
        const a = mv2?.files.get(path);
        const b = mv3?.files.get(path);
        let status: SourceStatus = "unchanged";
        if (both) {
            if (a && !b) status = "removed";
            else if (!a && b) status = "added";
            else if (a && b && (a.size !== b.size || sha1(a.abs) !== sha1(b.abs))) status = "modified";
        }
        const sample = b ?? a!;
        entries.push({
            path,
            status,
            size: { ...(a ? { mv2: a.size } : {}), ...(b ? { mv3: b.size } : {}) },
            binary: isBinary(path, readHead(sample.abs)),
        });
    }
    return { entries, truncated: Boolean(mv2?.truncated || mv3?.truncated) };
}

/**
 * One file, confined to its root.
 *
 * The path comes from a web page, so the rule is a whitelist on the resolved location, not a
 * blacklist on the string: after realpath, the file must sit under the realpath of the root. That
 * catches `..`, absolute paths, and a symlink pointing out of the extension in one check.
 */
export function readSourceFile(root: string, rel: string): SourceFile {
    if (typeof rel !== "string" || rel.length === 0 || rel.startsWith("/") || rel.split("/").includes("..")) {
        throw new Error(`refusing path outside the extension: ${rel}`);
    }
    const realRoot = realpathSync(root);
    let abs: string;
    try {
        abs = realpathSync(resolve(realRoot, rel));
    } catch {
        throw new Error(`no such file: ${rel}`);
    }
    if (!abs.startsWith(realRoot + sep)) {
        throw new Error(`refusing path outside the extension: ${rel}`);
    }
    const head = readHead(abs);
    if (isBinary(rel, head)) return { content: "", truncated: false, binary: true };
    const buf = readFileSync(abs);
    const truncated = buf.length > MAX_SOURCE_FILE;
    return { content: (truncated ? buf.subarray(0, MAX_SOURCE_FILE) : buf).toString("utf8"), truncated, binary: false };
}
