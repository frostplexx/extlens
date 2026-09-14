-- Phase 2 folder mode: SQLite schema (better-sqlite3).
-- FolderBackend ingests a plain directory of Chrome extensions into these
-- tables; lists serve from indexed SQL so large folders stay fast. The
-- extension id is a stable sha256 of the absolute source dir.

CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,               -- sha256 of the absolute source dir
  path TEXT NOT NULL,                -- absolute path to the extension root
  manifest_version INTEGER NOT NULL, -- 2 or 3
  name TEXT NOT NULL,                -- __MSG__-resolved display name
  version TEXT,                      -- nullable
  description TEXT,                  -- nullable
  score INTEGER NOT NULL,
  breakdown TEXT NOT NULL,           -- JSON of the ScoreBreakdown
  tags TEXT NOT NULL,                -- JSON array
  listeners TEXT NOT NULL,           -- JSON array of Listener
  surfaces TEXT NOT NULL DEFAULT '[]', -- JSON array of DetectedSurface
  manifest TEXT NOT NULL,            -- JSON of the ManifestSummary
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,         -- manifest mtime; re-ingest when it changes
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extensions_name ON extensions(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_extensions_score ON extensions(score);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL UNIQUE, -- one report per extension
  payload TEXT NOT NULL,             -- JSON of the ReportDraft
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_extension ON reports(extension_id);
