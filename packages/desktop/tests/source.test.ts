/**
 * The source reader hands a web page the contents of local directories, so the properties worth
 * pinning are the ones that keep it honest: the tree says exactly what changed between variants,
 * and a file read can never leave the extension it was asked about.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffSource, readSourceFile, MAX_SOURCE_FILE } from "../src/main/source.js";

const made: string[] = [];
function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "extlens-source-"));
    made.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string | Buffer): void {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
}

describe("diffSource", () => {
    it("labels every path by how it differs between the variants", () => {
        const mv2 = tmp();
        const mv3 = tmp();
        write(mv2, "manifest.json", '{"manifest_version":2}');
        write(mv3, "manifest.json", '{"manifest_version":3}');
        write(mv2, "same.js", "x");
        write(mv3, "same.js", "x");
        write(mv2, "sameSize.js", "aa");
        write(mv3, "sameSize.js", "ab");
        write(mv2, "gone.html", "<p>");
        write(mv3, "lib/new.js", "y");

        const byPath = Object.fromEntries(diffSource(mv2, mv3).entries.map((e) => [e.path, e.status]));
        expect(byPath).toEqual({
            "gone.html": "removed",
            "lib/new.js": "added",
            "manifest.json": "modified",
            "same.js": "unchanged",
            // Same size is not the same file: the content hash decides.
            "sameSize.js": "modified",
        });
    });

    it("treats a single variant as a plain tree", () => {
        const mv2 = tmp();
        write(mv2, "a.js", "x");
        const tree = diffSource(mv2, undefined);
        expect(tree.entries).toEqual([{ path: "a.js", status: "unchanged", size: { mv2: 1 }, binary: false }]);
    });

    it("skips node_modules and flags binaries", () => {
        const root = tmp();
        write(root, "node_modules/x/index.js", "x");
        write(root, "icon.png", Buffer.from([0x89, 0x50]));
        write(root, "blob", Buffer.from([1, 0, 2]));
        write(root, "a.js", "x");
        const paths = diffSource(root).entries.map((e) => [e.path, e.binary]);
        expect(paths).toEqual([
            ["a.js", false],
            ["blob", true],
            ["icon.png", true],
        ]);
    });
});

describe("readSourceFile", () => {
    it("reads a file relative to the root", () => {
        const root = tmp();
        write(root, "src/a.js", "hello");
        expect(readSourceFile(root, "src/a.js")).toEqual({ content: "hello", truncated: false, binary: false });
    });

    it("refuses anything that resolves outside the root", () => {
        const root = tmp();
        const outside = tmp();
        write(outside, "secret", "s");
        write(root, "a.js", "x");
        symlinkSync(join(outside, "secret"), join(root, "link"));
        expect(() => readSourceFile(root, "../" + outside.split("/").pop() + "/secret")).toThrow(/outside/);
        expect(() => readSourceFile(root, "/etc/passwd")).toThrow(/outside/);
        // A symlink is the one escape a string check cannot see; realpath can.
        expect(() => readSourceFile(root, "link")).toThrow(/outside/);
    });

    it("truncates oversized files and empties binaries", () => {
        const root = tmp();
        write(root, "big.js", "a".repeat(MAX_SOURCE_FILE + 10));
        write(root, "icon.png", Buffer.from([0x89]));
        const big = readSourceFile(root, "big.js");
        expect(big.truncated).toBe(true);
        expect(big.content.length).toBe(MAX_SOURCE_FILE);
        expect(readSourceFile(root, "icon.png")).toEqual({ content: "", truncated: false, binary: true });
    });
});
