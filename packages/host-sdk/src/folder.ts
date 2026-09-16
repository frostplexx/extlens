/**
 * FolderBackend: serve a plain directory of Chrome extensions over the
 * protocol. Discovery and analysis run once into SQLite (better-sqlite3);
 * list/sort/search then serve from indexed SQL, so folders with 100k
 * extensions stay responsive. Re-ingest is lazy: an extension whose
 * manifest mtime changed is re-analyzed on the next extensions.get.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { ExtensionSource, SourceFile } from "@extlens/analyzer";
import type {
  ExtensionLight,
  ExtensionProfile,
  FileRefs,
  ListParams,
  ListResult,
  Report,
  ReportDraft,
} from "@extlens/protocol";
import type { Backend } from "./backend.js";
import { computeProfile } from "./profile.js";
import { createExplainer, explainerConfigured, type Explainer } from "./explainer.js";

const MAX_TEXT_FILE = 10 * 1024 * 1024;

/** Stable extension id: sha256 of the absolute source dir. */
export function extensionIdFromPath(absPath: string): string {
  return createHash("sha256").update(resolve(absPath)).digest("hex");
}

function isExtensionRoot(dir: string): boolean {
  return existsSync(join(dir, "manifest.json"));
}

/**
 * Find the deepest directory under `root` (inclusive) that contains a
 * manifest.json. Nested extension dirs inside a corpus resolve to their own
 * root; directories inside an extension are not split apart.
 */
function findDeepestRoot(dir: string, depth: number): { root: string; depth: number } | null {
  if (isExtensionRoot(dir)) return { root: dir, depth };
  let best: { root: string; depth: number } | null = null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const found = findDeepestRoot(p, depth + 1);
    if (found && (!best || found.depth > best.depth)) best = found;
  }
  return best;
}

/** Every extension root (absolute path) under `folder`. */
export function discoverExtensions(folder: string): string[] {
  const root = resolve(folder);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const r = resolve(p);
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  };
  if (isExtensionRoot(root)) {
    add(root);
    return out;
  }
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === ".git") continue;
    const p = join(root, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const found = findDeepestRoot(p, 1);
    if (found) add(found.root);
  }
  return out;
}

function fileType(path: string): SourceFile["type"] {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (["js", "mjs", "cjs", "ts"].includes(ext)) return "js";
  if (["html", "htm"].includes(ext)) return "html";
  if (ext === "css") return "css";
  return "other";
}

function readTree(dir: string, prefix = ""): SourceFile[] {
  const files: SourceFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      files.push(...readTree(full, `${prefix}${entry}/`));
    } else if (st.size <= MAX_TEXT_FILE) {
      files.push({
        path: `${prefix}${entry}`,
        type: fileType(entry),
        content: readFileSync(full, "utf8"),
      });
    }
  }
  return files;
}

function readSource(root: string): ExtensionSource {
  let manifest: ExtensionSource["manifest"];
  try {
    manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  } catch {
    manifest = {};
  }
  return { id: extensionIdFromPath(root), manifest, files: readTree(root) };
}

interface ExtensionRow {
  id: string;
  path: string;
  manifest_version: number;
  name: string;
  version: string | null;
  description: string | null;
  score: number;
  breakdown: string;
  tags: string;
  listeners: string;
  surfaces: string;
  manifest: string;
  size_bytes: number;
  mtime_ms: number;
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export interface FolderBackendOptions {
  /** SQLite file path; defaults to <folder>/.extlens.sqlite. */
  dbPath?: string;
  /** Re-analyze when a manifest mtime changed. Default true. */
  refresh?: boolean;
  /** Progress callback during ingest (done, total). */
  onProgress?: (done: number, total: number) => void;
  /**
   * Model-backed failure explanations (analysis.explain). Defaults to one built from
   * ANTHROPIC_API_KEY when that is set; otherwise the method is not offered.
   */
  explainer?: Explainer | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  manifest_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  score INTEGER NOT NULL,
  breakdown TEXT NOT NULL,
  tags TEXT NOT NULL,
  listeners TEXT NOT NULL,
  surfaces TEXT NOT NULL DEFAULT '[]',
  manifest TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extensions_name ON extensions(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_extensions_score ON extensions(score);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_extension ON reports(extension_id);
`;

class FolderBackendImpl implements Backend {
  private readonly db: Database.Database;
  private readonly roots: string[];
  private readonly refresh: boolean;
  /**
   * Set on the instance rather than declared as a method so that a host without a model leaves
   * `explainFailure` undefined — which is how the SDK knows to answer -32601 instead of failing
   * on every call.
   */
  explainFailure?: Backend["explainFailure"];

  constructor(folder: string, opts: FolderBackendOptions = {}) {
    const dbPath = opts.dbPath ?? join(folder, ".extlens.sqlite");
    this.refresh = opts.refresh !== false;
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    this.migrate();
    this.roots = discoverExtensions(folder);
    this.ingest(opts.onProgress);
    const explainer = opts.explainer === undefined ? (explainerConfigured() ? createExplainer() : null) : opts.explainer;
    if (explainer) {
      this.explainFailure = async (id) => {
        const row = this.row(id);
        if (!row) return null;
        // A folder holds one variant per directory, so there is no diff — the model gets the
        // report, the manifest summary and the tree it has, and is told as much.
        const files = readTree(row.path);
        const profile = this.rowToProfile(row);
        return explainer.explain({
          profile,
          report: await this.getReport(id),
          ...(row.manifest_version === 3 ? { mv3: files } : { mv2: files }),
        });
      };
    }
  }

  /**
   * Bring an index built by an older version up to date.
   *
   * The extensions table is a cache re-derived from disk, so a column can simply be added with a
   * default: rows keep working, and each one picks up real content the next time its directory is
   * re-ingested. Reports are not a cache, which is why they are stored as an opaque JSON payload
   * and never need a migration of their own.
   */
  private migrate(): void {
    const columns = this.db.prepare("PRAGMA table_info(extensions)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "surfaces")) {
      this.db.exec("ALTER TABLE extensions ADD COLUMN surfaces TEXT NOT NULL DEFAULT '[]'");
      // Force a re-analysis: a default of [] would otherwise read as "this extension has no UI".
      this.db.exec("UPDATE extensions SET mtime_ms = -1");
    }
  }

  private ingest(onProgress?: (done: number, total: number) => void): void {
    const upsert = this.db.prepare(`
      INSERT INTO extensions (
        id, path, manifest_version, name, version, description, score,
        breakdown, tags, listeners, manifest, size_bytes, mtime_ms, ingested_at
      ) VALUES (
        @id, @path, @manifestVersion, @name, @version, @description, @score,
        @breakdown, @tags, @listeners, @manifest, @sizeBytes, @mtimeMs, @ingestedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        manifest_version = excluded.manifest_version,
        name = excluded.name,
        version = excluded.version,
        description = excluded.description,
        score = excluded.score,
        breakdown = excluded.breakdown,
        tags = excluded.tags,
        listeners = excluded.listeners,
        surfaces = excluded.surfaces,
        manifest = excluded.manifest,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        ingested_at = excluded.ingested_at
    `);
    const getMtime = this.db.prepare("SELECT mtime_ms FROM extensions WHERE id = ?");
    const now = new Date().toISOString();
    for (const [i, root] of this.roots.entries()) {
      const id = extensionIdFromPath(root);
      const mtime = mtimeMs(join(root, "manifest.json"));
      const row = getMtime.get(id) as { mtime_ms: number } | undefined;
      if (this.refresh && row && row.mtime_ms === mtime) {
        onProgress?.(i + 1, this.roots.length);
        continue;
      }
      const source = readSource(root);
      const profile = computeProfile(source);
      upsert.run({
        id,
        path: root,
        manifestVersion: profile.manifestVersion,
        name: profile.name,
        version: profile.version,
        description: profile.manifest.description,
        score: profile.score,
        breakdown: JSON.stringify(profile.breakdown),
        tags: JSON.stringify(profile.tags),
        listeners: JSON.stringify(profile.listeners),
        surfaces: JSON.stringify(profile.surfaces ?? []),
        manifest: JSON.stringify(profile.manifest),
        sizeBytes: profile.sizeBytes,
        mtimeMs: mtime,
        ingestedAt: now,
      });
      onProgress?.(i + 1, this.roots.length);
    }
  }

  private reingestOne(id: string): ExtensionRow | null {
    const root = this.roots.find((r) => extensionIdFromPath(r) === id);
    if (!root) return null;
    this.ingest();
    return this.row(id);
  }

  private row(id: string): ExtensionRow | null {
    return (this.db.prepare("SELECT * FROM extensions WHERE id = ?").get(id) as
      | ExtensionRow
      | undefined) ?? null;
  }

  private rowToLight(row: ExtensionRow, hasReport: boolean): ExtensionLight {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      manifestVersion: row.manifest_version,
      score: row.score,
      tags: JSON.parse(row.tags) as string[],
      hasMv3: false,
      hasReport,
    };
  }

  private rowToProfile(row: ExtensionRow): ExtensionProfile {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      manifestVersion: row.manifest_version,
      score: row.score,
      breakdown: JSON.parse(row.breakdown),
      tags: JSON.parse(row.tags) as string[],
      listeners: JSON.parse(row.listeners),
      surfaces: JSON.parse(row.surfaces ?? "[]"),
      manifest: JSON.parse(row.manifest),
      sizeBytes: row.size_bytes,
      hasMv3: false,
    };
  }

  async listExtensions(params: ListParams): Promise<ListResult> {
    const search = params.search?.trim().toLowerCase();
    const where = search
      ? "WHERE (name LIKE @like OR id LIKE @like OR version LIKE @like)"
      : "";
    const order =
      params.sort === "name"
        ? "ORDER BY name COLLATE NOCASE, id"
        : params.sort === "interestingness_asc"
          ? "ORDER BY score ASC, id"
          : "ORDER BY score DESC, id";
    const like = `%${search}%`;
    const countStmt = this.db.prepare(`SELECT COUNT(*) AS n FROM extensions ${where}`);
    const total = ((search ? countStmt.get({ like }) : countStmt.get()) as { n: number }).n;
    const pageStmt = this.db.prepare(
      `SELECT * FROM extensions ${where} ${order} LIMIT @limit OFFSET @offset`,
    );
    const pageRows = (search
      ? pageStmt.all({ like, limit: params.pageSize, offset: (params.page - 1) * params.pageSize })
      : pageStmt.all({ limit: params.pageSize, offset: (params.page - 1) * params.pageSize })) as unknown as ExtensionRow[];
    const statsStmt = this.db.prepare(
      `SELECT COUNT(*) AS n, AVG(score) AS avg, SUM(CASE WHEN manifest_version = 3 THEN 1 ELSE 0 END) AS mv3 FROM extensions ${where}`,
    );
    const statsRow = (search ? statsStmt.get({ like }) : statsStmt.get()) as {
      n: number;
      avg: number | null;
      mv3: number | null;
    };
    // One query for the report set: any extension with a report counts as tested.
    const reported = new Set(
      (this.db.prepare("SELECT extension_id FROM reports").all() as {
        extension_id: string;
      }[]).map((r) => r.extension_id),
    );
    return {
      extensions: pageRows.map((r) => this.rowToLight(r, reported.has(r.id))),
      stats: {
        total,
        analyzed: total,
        withMv3: statsRow.mv3 ?? 0,
        avgScore: statsRow.avg ?? 0,
      },
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    };
  }

  async getExtension(id: string) {
    let row = this.row(id);
    if (!row) return null;
    if (this.refresh) {
      const root = this.roots.find((r) => extensionIdFromPath(r) === id);
      const mtime = root ? mtimeMs(join(root, "manifest.json")) : 0;
      if (row.mtime_ms !== mtime) row = this.reingestOne(id);
    }
    if (!row) return null;
    // The stored profile overrides the SDK-computed one wholesale, so the
    // source can stay minimal — files are never re-read here.
    return { source: { id, manifest: {}, files: [] }, profile: this.rowToProfile(row) };
  }

  async getFiles(id: string): Promise<FileRefs | null> {
    const row = this.row(id);
    if (!row) return null;
    const ref = pathToFileURL(join(row.path)).href;
    return row.manifest_version === 3 ? { mv3: ref } : { mv2: ref };
  }

  async getReport(extensionId: string): Promise<Report | null> {
    const row = this.db
      .prepare("SELECT id, payload, created_at, updated_at FROM reports WHERE extension_id = ?")
      .get(extensionId) as
      | { id: string; payload: string; created_at: string; updated_at: string }
      | undefined;
    if (!row) return null;
    return { ...(JSON.parse(row.payload) as object), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at } as Report;
  }

  async submitReport(report: ReportDraft): Promise<string> {
    const id = report.extensionId;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reports (id, extension_id, payload, created_at, updated_at)
         VALUES (@id, @id, @payload, @now, @now)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run({ id, payload: JSON.stringify(report), now });
    return id;
  }

  close(): void {
    this.db.close();
  }
}

/** Build a Backend over a plain folder of Chrome extensions. */
export function createFolderBackend(folder: string, opts: FolderBackendOptions = {}): Backend {
  return new FolderBackendImpl(folder, opts);
}
