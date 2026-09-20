import { defineConfig } from "tsup";

/**
 * Main and preload are bundled, the renderer is vite's. Workspace packages are pulled in — they
 * ship TypeScript source, which Electron cannot load — while everything from npm stays external
 * and is resolved from node_modules at run time, playwright included.
 */
export default defineConfig({
    entry: { "main/index": "src/main/index.ts", "preload/index": "src/preload/index.ts" },
    outDir: "dist",
    format: "cjs",
    platform: "node",
    target: "node22",
    sourcemap: true,
    clean: false,
    noExternal: [/^@extlens\//],
    external: ["electron", "playwright"],
});
