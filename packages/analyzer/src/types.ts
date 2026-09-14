import type { DetectedSurface } from "./surfaces.js";

/**
 * Input/output types for the pure analyzer. The analyzer takes an immutable
 * ExtensionSource and returns a new AnalysisProfile. It never mutates its
 * input and has no knowledge of hosts, migration pipelines, or storage.
 */

export type FileType = "js" | "css" | "html" | "other";

export interface SourceFile {
  path: string;
  type: FileType;
  content: string;
}

/** A parsed manifest.json. Fields are unknown; analyzers narrow them. */
export interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  permissions?: unknown;
  host_permissions?: unknown;
  background?: unknown;
  content_scripts?: unknown;
  action?: unknown;
  browser_action?: unknown;
  page_action?: unknown;
  options_page?: unknown;
  chrome_url_overrides?: unknown;
  service_worker?: unknown;
  [key: string]: unknown;
}

export interface ExtensionSource {
  id: string;
  manifest: Manifest;
  files: SourceFile[];
}

export interface Listener {
  api: string; // e.g. "chrome.runtime.onMessage"
  file: string; // path within the extension
  line: number; // 1-indexed
  snippet: string; // trimmed line, capped at 100 chars
}

export interface AnalysisProfile {
  id: string;
  name: string;
  version: string | null;
  manifestVersion: number;
  score: number;
  breakdown: import("./scoring.js").ScoreBreakdown;
  tags: string[];
  listeners: Listener[];
  sizeBytes: number;
  /** User-facing surfaces the extension declares or uses, with the evidence for each. */
  surfaces: DetectedSurface[];
}
