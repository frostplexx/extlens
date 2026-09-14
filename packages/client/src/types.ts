import type {
  ExtensionLight,
  ListStats,
  OverallWorking,
  SortOrder,
  SurfaceStatus,
  UiSurface,
} from "@extlens/protocol";

// Session-level shapes belong to @extlens/session, which both front ends share; re-exported here
// so client modules keep importing their UI types from one place.
export type { BrowserPhase, BrowserState, ConnectionStatus } from "@extlens/session";

/**
 * UI state shared across components.
 *
 * State that belongs to exactly one hook lives with that hook instead (AnalyzerSubject in
 * state/useAnalyzer.ts, Browsers in state/useBrowsers.ts). Only shapes more than one module has
 * to name are here.
 */

/** Which screen the client shows. There is no tab bar; enter/esc move between explorer and analyzer. */
export type View = "explorer" | "analyzer" | "log";

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
  /** One status per detected surface; the per-extension score and verdict derive from these. */
  surfaceStatus: Partial<Record<UiSurface, SurfaceStatus>>;
  /** Index of the focused row in the visible row list. */
  cursor: number;
  notesFocused: boolean;
  saving: boolean;
  savedId: string | null;
  error: string | null;
  /** Date.now() when the form opened, for the auto-collected duration. */
  verificationStart: number;
}
