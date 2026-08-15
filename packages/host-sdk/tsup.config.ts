import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  // Bundle the workspace packages so the published artifact is self-contained.
  noExternal: ["@extlens/protocol", "@extlens/analyzer"],
});
