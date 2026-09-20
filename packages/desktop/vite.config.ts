import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

/**
 * The renderer. In production Electron serves the build from its own `app://` scheme
 * (src/main/static.ts), so this is a plain static bundle with relative asset paths; `npm run dev`
 * points the window at vite instead for HMR.
 */
export default defineConfig({
    plugins: [react(), tailwind()],
    // `@/…` matches the shadcn convention, and keeps component imports stable if files move.
    resolve: { alias: { "@": fileURLToPath(new URL("./src/renderer", import.meta.url)) } },
    base: "./",
    build: {
        outDir: "dist/renderer",
        emptyOutDir: true,
        /*
         * The default 500 kB warning is about download cost over a network. This bundle is read
         * off disk by the process that owns the window, so splitting it would trade a measurable
         * startup simplification for nothing. Raised deliberately, not silenced.
         *
         * Monaco is the exception: it is several MB on its own and only Code mode needs it, so it
         * is its own chunk behind a lazy import, and the limit covers it rather than the main one.
         */
        chunkSizeWarningLimit: 5000,
        rollupOptions: {
            output: {
                manualChunks: { monaco: ["monaco-editor"] },
            },
        },
    },
    server: { port: 5173 },
});
