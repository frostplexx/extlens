import type {
  ExtensionLight,
  ExtensionProfile,
  FileRefs,
  ListStats,
  Report,
  SortOrder,
} from "@extlens/protocol";

/** UI state types for the client. */

export type Tab = "explorer" | "analyzer";

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
  | "closed";

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
}

export type TriState = boolean | null;

export interface ReportDraftForm {
  tested: TriState;
  overallWorking: TriState;
  hasErrors: TriState;
  seemsSlower: TriState;
  needsLogin: TriState;
  isPopupBroken: TriState;
  isSettingsBroken: TriState;
  isInteresting: TriState;
  notes: string;
  listenerStatus: ("untested" | "yes" | "no")[];
  /** Index of the focused row; notes is the last row. */
  cursor: number;
  notesFocused: boolean;
  saving: boolean;
  savedId: string | null;
  error: string | null;
}
