import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

/**
 * The UI is served by our own node server (server/index.ts), not by vite in production, so the
 * build is a plain static bundle with relative asset paths.
 */
export default defineConfig({
    plugins: [react(), tailwind()],
    // `@/…` matches the shadcn convention, and keeps component imports stable if files move.
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    base: "./",
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5173 },
});
