import type {
  FileRefs,
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
}
