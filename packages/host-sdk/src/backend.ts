import type {
  ReportRow,
  FileRefs,
  HostLogResult,
  HostStatus,
  ListParams,
  ListResult,
  Report,
  ReportDraft,
  ExtensionProfile,
} from "@extlens/protocol";
import type { ExtensionSource } from "@extlens/analyzer";

/**
 * The contract hosts implement. The SDK validates protocol messages and
 * dispatches to these methods. Hosts map their own storage onto this
 * interface; the SDK never touches host storage.
 */

export interface GetExtensionResult {
  /** Raw source (manifest + files with contents). The SDK analyzes it. */
  source: ExtensionSource;
  /**
   * Optional host-provided profile overrides. Present fields replace the
   * SDK-computed ones. Use this when the host has its own analysis
   * (e.g. stored score/breakdown/tags) or knows host-only facts (hasMv3).
   */
  profile?: Partial<ExtensionProfile>;
}

/**
 * Optional host lifecycle controller behind host.status / host.start /
 * host.stop. Implement it when the host can start and abort a job (for
 * AgenticMigrator: a migration) for a listed extension. Throwing an RpcError
 * maps to a protocol error (HOST_BUSY, UNKNOWN_EXTENSION, ...).
 */
export interface HostController {
  /** Current lifecycle status. Never throws. */
  getStatus(): Promise<HostStatus>;
  /** Start a job for the extension. Throws when busy or the id is unknown. */
  start(id: string): Promise<HostStatus>;
  /** Start a job over the whole corpus (all outstanding extensions). Optional: hosts without it answer -32601 for host.startAll. */
  startAll?(): Promise<HostStatus>;
  /** Abort the running job. No-op (returns status) when idle. */
  stop(): Promise<HostStatus>;
  /**
   * Incremental host log lines with seq > offset. Optional for backward
   * compatibility: hosts without it get an empty result from the SDK.
   */
  getLog?(offset: number): Promise<HostLogResult>;
}

export interface Backend {
  /** Light list plus aggregate stats for the explorer tab. */
  listExtensions(params: ListParams): Promise<ListResult>;

  /** Full source for one extension. null means unknown id. */
  getExtension(id: string): Promise<GetExtensionResult | null>;

  /** File references for the browser review flow. null means unknown id. */
  getFiles(id: string): Promise<FileRefs | null>;

  /** Stored report for an extension, or null when none exists. */
  getReport(extensionId: string): Promise<Report | null>;

  /** Store (or replace) the report. Returns the report id. */
  submitReport(report: ReportDraft): Promise<string>;

  /**
   * Every stored report, for export.
   *
   * Optional: a backend that cannot enumerate its reports simply does not offer the export, rather
   * than the client having to fetch them one extension at a time — which for a corpus of hundreds
   * is a request storm to answer a question the host can answer in one query.
   */
  listReports?(): Promise<ReportRow[]>;

  /** Optional host lifecycle controller (migration start/stop/status). */
  host?: HostController;
}
