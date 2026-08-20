import type {
  ExtensionLight,
  ExtensionProfile,
  FileRefs,
  ListStats,
  OverallWorking,
  Report,
  SortOrder,
} from "@extlens/protocol";

/** UI state types for the client. */

/** Which screen the client shows. There is no tab bar; enter/esc move between explorer and analyzer. */
export type View = "explorer" | "analyzer" | "log";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ExplorerState {
  lights: ExtensionLight[];
  stats: ListStats | null;
  page: number;
  totalPages: number;
  search: string;
  /** True while the search box is the input focus. */
  searchFocused: boolean;
  sort: SortOrder;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
}

export type BrowserPhase =
  | "idle"
  | "launching"
  | "detecting"
  | "loaded"
  | "failed"
  | "closed"
  | "downloading";

export interface BrowserState {
  phase: BrowserPhase;
  message: string | null;
  extensionId: string | null;
}

export interface AnalyzerState {
  id: string | null;
  profile: ExtensionProfile | null;
  files: FileRefs | null;
  report: Report | null;
  loading: boolean;
  error: string | null;
  mv2: BrowserState;
  mv3: BrowserState;
  /** True while the report form is open. */
  formOpen: boolean;
  /** Missing browsers queued for a download decision (FIFO). */
  prompts: { label: "mv2" | "mv3"; message: string }[];
  /** First visible line index when the analyzer content is taller than the terminal. */
  scroll: number;
}

export interface ReportDraftForm {
  installs: boolean;
  worksInMv2: boolean;
  needsLogin: boolean;
  isPopupWorking: boolean;
  isSettingsWorking: boolean;
  isNewTabWorking: boolean;
  isInteresting: boolean;
  overallWorking: OverallWorking;
  notes: string;
  listenerStatus: ("untested" | "yes" | "no")[];
  /** Index of the focused row in the visible row list. */
  cursor: number;
  notesFocused: boolean;
  saving: boolean;
  savedId: string | null;
  error: string | null;
  /** Date.now() when the form opened, for the auto-collected duration. */
  verificationStart: number;
}
