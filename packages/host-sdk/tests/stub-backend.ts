import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  Backend,
  ExtensionSource,
  HostStatus,
  Report,
} from "../src/index.js";
import { computeProfile } from "../src/profile.js";
import { RpcError } from "../src/rpc.js";
import { ErrorCodes, matchesListFilter, reportVerdict } from "../src/index.js";

/** In-memory backend over the synthetic fixtures. */
export function loadFixture(dirName: string): ExtensionSource {
  const dir = join(import.meta.dirname, "..", "..", "..", "fixtures", dirName);
  const files: { path: string; type: "js" | "css" | "html" | "other"; content: string }[] = [];
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

export function makeStubBackend(): Backend & { reports: Map<string, Report> } {
  const sources = new Map<string, ExtensionSource>();
  for (const name of ["one-ext", "corpus-a/minimal"]) {
    const source = loadFixture(name);
    sources.set(source.id, source);
  }

  const reports = new Map<string, Report>();

  return {
    reports,

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
          hasReport: reports.has(profile.id),
          verdict: reports.has(profile.id) ? reportVerdict(reports.get(profile.id)!) : null,
        };
      });
      const sorted = [...all].sort((a, b) => {
        if (params.sort === "name") return a.name.localeCompare(b.name);
        return params.sort === "interestingness_asc" ? a.score - b.score : b.score - a.score;
      });
      const search = params.search;
      const searched = search
        ? sorted.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
        : sorted;
      const filtered = searched.filter((e) => matchesListFilter(e, params.filter));
      const page = params.page;
      const pageSize = params.pageSize;
      const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        extensions: paged,
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
      if (!sources.has(id)) return null;
      return { mv2: `file://${join(import.meta.dirname, "..", "..", "..", "fixtures", id)}` };
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

    // The stub has no migration capability: status reports idle, start/stop
    // answer -32601 so the client can exercise graceful handling.
    host: {
      async getStatus(): Promise<HostStatus> {
        return { state: "idle", extensionId: null, phase: null, startedAt: null, message: null };
      },
      async start(): Promise<HostStatus> {
        throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "stub host cannot run migrations");
      },
      async stop(): Promise<HostStatus> {
        return { state: "idle", extensionId: null, phase: null, startedAt: null, message: null };
      },
    },
  };
}
