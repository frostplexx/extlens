/**
 * Reference Backend over the synthetic fixtures, runnable standalone. This is
 * the minimal shape every host adapter implements: five methods over its own
 * storage. It reads extension dirs from disk, computes profiles with the SDK
 * default flow, and stores reports in memory.
 *
 * Run:
 *   npm run build   (once, so the SDK dist exists)
 *   npx tsx examples/stub-server.ts [port]
 * Then connect the client: npm run client -- --ws ws://localhost:8081
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  createExplainer,
  createExtlensServer,
  computeProfile,
  explainerConfigured,
  type Backend,
  type ExtensionSource,
  type Report,
  type SourceFile,
} from "extlens-sdk";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

function loadExtension(dir: string): ExtensionSource {
  const root = join(FIXTURES, dir);
  const files: SourceFile[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry !== "manifest.json") {
        const content = readFileSync(full, "utf8");
        const ext = entry.split(".").pop()!.toLowerCase();
        const type =
          ext === "js" ? "js" : ext === "html" || ext === "htm" ? "html" : ext === "css" ? "css" : "other";
        files.push({ path: relative(root, full).split("\\").join("/"), type, content });
      }
    }
  };
  walk(root);
  return {
    id: dir.split("/").pop()!,
    manifest: JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")),
    files,
  };
}

const DIRS = ["one-ext", "corpus-a/webpack-bundled", "corpus-a/minimal"];

function makeBackend(): Backend {
  const sources = new Map<string, ExtensionSource>();
  for (const dir of DIRS) {
    const source = loadExtension(dir);
    sources.set(source.id, source);
  }
  const reports = new Map<string, Report>();

  return {
    async listExtensions(params) {
      const all = [...sources.values()].map((source) => {
        const profile = computeProfile(source);
        return {
          id: profile.id,
          name: profile.name,
          version: profile.version,
          manifestVersion: profile.manifestVersion,
          score: profile.score,
          tags: profile.tags,
          hasMv3: profile.hasMv3,
          // Required by ExtensionLight (packages/protocol/src/messages.ts). Omitting it made
          // every listExtensions response fail protocol validation, so the documented
          // quickstart showed a wall of zod errors instead of the fixture list.
          hasReport: reports.has(profile.id),
        };
      });
      const sorted = [...all].sort((a, b) => {
        if (params.sort === "name") return a.name.localeCompare(b.name);
        return params.sort === "interestingness_asc" ? a.score - b.score : b.score - a.score;
      });
      const search = params.search;
      const filtered = search
        ? sorted.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
        : sorted;
      const page = params.page;
      const pageSize = params.pageSize;
      return {
        extensions: filtered.slice((page - 1) * pageSize, page * pageSize),
        stats: {
          total: all.length,
          analyzed: all.length,
          withMv3: all.filter((e) => e.hasMv3).length,
          avgScore: all.reduce((sum, e) => sum + e.score, 0) / all.length,
        },
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      };
    },

    async getExtension(id) {
      const source = sources.get(id);
      return source ? { source } : null;
    },

    async getFiles(id) {
      const source = sources.get(id);
      if (!source) return null;
      // The fixture dir contains the mv2 manifest at its root.
      const mv2 = `file://${join(FIXTURES, DIRS.find((d) => d.split("/").pop() === id)!)}`;
      // one-ext has a hand-migrated sibling, so the code explorer's diff has something to show.
      return id === "one-ext" ? { mv2, mv3: `file://${join(FIXTURES, "one-ext-mv3")}` } : { mv2 };
    },

    async getReport(extensionId) {
      return reports.get(extensionId) ?? null;
    },

    async submitReport(report) {
      const id = `report-${report.extensionId}`;
      const now = new Date().toISOString();
      reports.set(report.extensionId, { ...report, id, createdAt: now, updatedAt: now });
      return id;
    },

    // Only offered with a key in the environment; the SDK answers -32601 otherwise.
    ...(explainerConfigured()
      ? {
          async explainFailure(id: string) {
            const source = sources.get(id);
            if (!source) return null;
            const explainer = createExplainer();
            const withManifest = (s: ExtensionSource): SourceFile[] => [
              { path: "manifest.json", type: "other", content: JSON.stringify(s.manifest, null, 2) + "\n" },
              ...s.files,
            ];
            const mv3 = id === "one-ext" ? loadExtension("one-ext-mv3") : null;
            return explainer.explain({
              profile: computeProfile(source),
              report: reports.get(id) ?? null,
              mv2: withManifest(source),
              ...(mv3 ? { mv3: withManifest(mv3) } : {}),
            });
          },
        }
      : {}),
  };
}

function parsePort(): number {
  const flagIndex = process.argv.indexOf("--port");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    const p = Number(process.argv[flagIndex + 1]);
    if (Number.isInteger(p) && p >= 0 && p < 65536) return p;
  }
  const positional = Number(process.argv[2]);
  if (Number.isInteger(positional) && positional >= 0 && positional < 65536) return positional;
  const fromEnv = Number(process.env.EXLENS_PORT);
  if (Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 65536) return fromEnv;
  return 8081;
}

const port = parsePort();
const server = createExtlensServer({ port, backend: makeBackend() });
console.log(`extlens stub server on ws://localhost:${server.port}`);
console.log("press Ctrl+C to stop");
