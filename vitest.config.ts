import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Anchor root to the repo so `npm test` works from any package dir.
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
