import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionSource, SourceFile } from "../src/index.js";

/** Load a fixture directory (manifest.json + all other files) as ExtensionSource. */
export function loadFixture(dirName: string): ExtensionSource {
  const dir = join(import.meta.dir, "..", "..", "..", "fixtures", dirName);
  const files: SourceFile[] = [];
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}${entry}/`);
      } else if (entry !== "manifest.json") {
        const content = readFileSync(full, "utf8");
        const ext = entry.split(".").pop()!.toLowerCase();
        const type = ext === "js" ? "js" : ext === "html" || ext === "htm" ? "html" : ext === "css" ? "css" : "other";
        files.push({ path: `${prefix}${entry}`, type, content });
      }
    }
  };
  walk(dir, "");
  return {
    id: dirName.split("/").pop()!,
    manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
    files,
  };
}
