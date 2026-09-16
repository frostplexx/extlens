import type { z } from "zod";
import type {
  ExtensionLightSchema,
  ExtensionProfileSchema,
  FileRefsSchema,
  HostLogResultSchema,
  HostStatusSchema,
  ListParamsSchema,
  ListResultSchema,
  ListStatsSchema,
  ListenerSchema,
  LogLineSchema,
  ListenerTestResultSchema,
  ManifestSummarySchema,
  OverallWorkingSchema,
  ReportDraftSchema,
  ReportRowSchema,
  ReportSchema,
  ScoreBreakdownSchema,
  SortOrderSchema,
  SurfaceResultSchema,
  SurfaceStatusSchema,
  UiSurfaceSchema,
  ExtensionVerdictSchema,
  ExplainResultSchema,
} from "./messages.js";

/**
 * Protocol types. All are inferred from the zod schemas in messages.ts so the
 * wire contract and the TS types cannot drift.
 */

export type ExtensionLight = z.infer<typeof ExtensionLightSchema>;
export type ExtensionProfile = z.infer<typeof ExtensionProfileSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type Listener = z.infer<typeof ListenerSchema>;
export type ManifestSummary = z.infer<typeof ManifestSummarySchema>;
export type FileRefs = z.infer<typeof FileRefsSchema>;
export type ListStats = z.infer<typeof ListStatsSchema>;
export type ListParams = z.infer<typeof ListParamsSchema>;
export type SortOrder = z.infer<typeof SortOrderSchema>;
export type ListResult = z.infer<typeof ListResultSchema>;
export type ReportDraft = z.infer<typeof ReportDraftSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type OverallWorking = z.infer<typeof OverallWorkingSchema>;
export type ListenerTestResult = z.infer<typeof ListenerTestResultSchema>;
export type HostStatus = z.infer<typeof HostStatusSchema>;
export type LogLine = z.infer<typeof LogLineSchema>;
export type HostLogResult = z.infer<typeof HostLogResultSchema>;

export type ReportRow = z.infer<typeof ReportRowSchema>;
export type UiSurface = z.infer<typeof UiSurfaceSchema>;
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>;
export type SurfaceResult = z.infer<typeof SurfaceResultSchema>;
export type ExtensionVerdict = z.infer<typeof ExtensionVerdictSchema>;
export type DetectedSurface = { surface: UiSurface; evidence: string };
export type ExplainResult = z.infer<typeof ExplainResultSchema>;
