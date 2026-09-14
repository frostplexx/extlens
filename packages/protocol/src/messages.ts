import { z } from "zod";

/**
 * Zod schemas for every protocol envelope, method param, and method result.
 * The types in types.ts are inferred from these schemas so the wire contract
 * and the TS types cannot drift.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const JsonRpcSchema = z.literal("2.0");

/** Request id: a number or a string. The response echoes it. */
export const RequestIdSchema = z.union([z.number().int(), z.string().min(1)]);

export const RequestEnvelopeSchema = z.object({
  jsonrpc: JsonRpcSchema,
  id: RequestIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const ErrorObjectSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const SuccessEnvelopeSchema = z.object({
  jsonrpc: JsonRpcSchema,
  id: RequestIdSchema,
  result: z.unknown(),
});

export const ErrorEnvelopeSchema = z.object({
  jsonrpc: JsonRpcSchema,
  id: z.union([RequestIdSchema, z.null()]),
  error: ErrorObjectSchema,
});

export const ResponseEnvelopeSchema = z.union([
  SuccessEnvelopeSchema,
  ErrorEnvelopeSchema,
]);

// ---------------------------------------------------------------------------
// Shared scalars
// ---------------------------------------------------------------------------

/** Extension id: opaque string, bounded to keep schemas safe. */
export const ExtensionIdSchema = z.string().min(1).max(512);

export const SortOrderSchema = z.enum([
  "interestingness_desc",
  "interestingness_asc",
  "name",
]);

// ---------------------------------------------------------------------------
// ping
// ---------------------------------------------------------------------------

export const PingResultSchema = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// extensions.list
// ---------------------------------------------------------------------------

export const ListParamsSchema = z
  .object({
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(1).max(200).default(50),
    search: z.string().max(200).optional(),
    sort: SortOrderSchema.default("interestingness_desc"),
  })
  .default({});

export const ExtensionLightSchema = z.object({
  id: ExtensionIdSchema,
  name: z.string(),
  version: z.string().nullable(),
  manifestVersion: z.number().int().min(2).max(3),
  score: z.number().int(),
  tags: z.array(z.string()),
  hasMv3: z.boolean(),
  /** A report exists for this extension (it was tested). */
  hasReport: z.boolean(),
});

export const ListStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  analyzed: z.number().int().nonnegative(),
  withMv3: z.number().int().nonnegative(),
  avgScore: z.number().nonnegative(),
});

export const ListResultSchema = z.object({
  extensions: z.array(ExtensionLightSchema).max(200),
  stats: ListStatsSchema,
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(200),
  totalPages: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// extensions.get
// ---------------------------------------------------------------------------

export const ScoreBreakdownSchema = z.object({
  webRequest: z.number().int().nonnegative(),
  htmlLines: z.number().int().nonnegative(),
  storageLocal: z.number().int().nonnegative(),
  backgroundPage: z.number().int().nonnegative(),
  contentScripts: z.number().int().nonnegative(),
  dangerousPermissions: z.number().int().nonnegative(),
  hostPermissions: z.number().int().nonnegative(),
  cryptoPatterns: z.number().int().nonnegative(),
  networkRequests: z.number().int().nonnegative(),
  extensionSize: z.number().int().nonnegative(),
  apiRenames: z.number().int().nonnegative(),
  manifestChanges: z.number().int().nonnegative(),
  fileModifications: z.number().int().nonnegative(),
  webRequestToDnr: z.number().int().nonnegative(),
});

export const ListenerSchema = z.object({
  api: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  snippet: z.string(),
});

export const BackgroundSummarySchema = z.object({
  type: z.enum(["page", "service_worker"]),
  scripts: z.array(z.string()),
});

export const ContentScriptSummarySchema = z.object({
  matches: z.array(z.string()),
  js: z.array(z.string()),
  css: z.array(z.string()),
});

export const ActionSummarySchema = z.object({
  defaultPopup: z.string().nullable(),
  defaultTitle: z.string().nullable(),
});

export const ManifestSummarySchema = z.object({
  manifestVersion: z.number().int().min(2).max(3),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  /** Chrome extension id for this manifest: key-derived, else host-assigned. */
  id: z.string().nullable().optional(),
  permissions: z.array(z.string()),
  hostPermissions: z.array(z.string()),
  background: BackgroundSummarySchema.nullable(),
  contentScripts: z.array(ContentScriptSummarySchema),
  action: ActionSummarySchema.nullable(),
  optionsPage: z.string().nullable(),
  chromeUrlOverrides: z.object({ newtab: z.string().nullable() }),
});

/**
 * The user-facing surfaces a review can cover.
 *
 * Kept in the protocol rather than derived per client so a stored report stays readable: a result
 * row naming a surface the reader cannot enumerate is not analysable later.
 */
export const UiSurfaceSchema = z.enum([
  "popup",
  "toolbar_action",
  "options_page",
  "new_tab",
  "side_panel",
  "devtools",
  "context_menu",
  "notifications",
  "keyboard_shortcuts",
  "omnibox",
  "page_interaction",
  "background",
]);

/**
 * What the reviewer saw for one surface.
 *
 * "not_testable" is a first-class outcome, not a flavour of broken: an extension whose popup
 * needs a paid account is evidence about the harness, not about the migration, and collapsing the
 * two is what makes a success rate unfalsifiable.
 */
export const SurfaceStatusSchema = z.enum(["untested", "working", "partial", "broken", "not_testable"]);

export const SurfaceResultSchema = z.object({
  surface: UiSurfaceSchema,
  status: SurfaceStatusSchema,
  /** Why it is broken or untestable, in the reviewer's words. */
  note: z.string().default(""),
});

/**
 * Per-extension verdict.
 *
 * Four states rather than the older tri-state boolean, because "some of it works" is the common
 * outcome of an MV3 migration and had nowhere to go: a partially working extension had to be
 * recorded as either a success or a total loss.
 */
export const ExtensionVerdictSchema = z.enum([
  "working",
  "partially_working",
  "not_working",
  "not_testable",
]);

export const ExtensionProfileSchema = z.object({
  id: ExtensionIdSchema,
  name: z.string(),
  version: z.string().nullable(),
  manifestVersion: z.number().int().min(2).max(3),
  score: z.number().int(),
  breakdown: ScoreBreakdownSchema,
  tags: z.array(z.string()),
  listeners: z.array(ListenerSchema),
  /** Surfaces detected in the source, so a client can ask about exactly what exists. */
  surfaces: z.array(z.object({ surface: UiSurfaceSchema, evidence: z.string() })).default([]),
  manifest: ManifestSummarySchema,
  /** Manifest summary of the mv2 source, when the extension was migrated. */
  mv2: ManifestSummarySchema.nullable().optional(),
  sizeBytes: z.number().int().nonnegative(),
  hasMv3: z.boolean(),
});

// ---------------------------------------------------------------------------
// extensions.files
// ---------------------------------------------------------------------------

export const FileRefsSchema = z.object({
  mv2: z.string().min(1).optional(),
  mv3: z.string().optional(),
});

// ---------------------------------------------------------------------------
// reports.get / reports.submit
// ---------------------------------------------------------------------------

export const ListenerTestStatusSchema = z.enum(["untested", "yes", "no"]);

export const ListenerTestResultSchema = z.object({
  api: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nullable(),
  status: ListenerTestStatusSchema,
});

/** Overall working verdict: yes, no, or could not test. */
export const OverallWorkingSchema = z.enum(["yes", "no", "could_not_test"]);

/**
 * Accepts legacy boolean overallWorking values (true -> "yes", false -> "no")
 * so reports written before the tri-state string survive re-validation.
 */
export const ReportOverallWorkingSchema = z.preprocess(
  (value) => (typeof value === "boolean" ? (value ? "yes" : "no") : value),
  OverallWorkingSchema,
);

/**
 * Client -> host report payload, matching the ExtPorter report form. The host
 * stamps id and timestamps. The quick-assessment booleans are nullable so
 * hosts can serve reports written before this field set existed.
 */
export const ReportDraftSchema = z.object({
  extensionId: ExtensionIdSchema,
  tested: z.boolean(),
  verificationDurationSecs: z.number().nonnegative().nullable().default(null),
  installs: z.boolean().nullable().default(null),
  worksInMv2: z.boolean().nullable().default(null),
  needsLogin: z.boolean().nullable().default(null),
  isPopupWorking: z.boolean().nullable().default(null),
  isSettingsWorking: z.boolean().nullable().default(null),
  isNewTabWorking: z.boolean().nullable().default(null),
  isInteresting: z.boolean().nullable().default(null),
  overallWorking: ReportOverallWorkingSchema.nullable().default(null),
  notes: z.string().default(""),
  listeners: z.array(ListenerTestResultSchema).default([]),
  /** One row per surface the extension has. Empty on reports written before surfaces existed. */
  surfaces: z.array(SurfaceResultSchema).default([]),
  /** Four-state verdict. Null on legacy reports, which carry overallWorking instead. */
  verdict: ExtensionVerdictSchema.nullable().default(null),
  /**
   * Preserved-behaviour score in [0, 1]: the share of testable surfaces that still work, with a
   * partial counting as a half. Null when nothing was testable — which is not the same as zero.
   */
  score: z.number().min(0).max(1).nullable().default(null),
});

/** Full report as returned by reports.get. */
export const ReportSchema = ReportDraftSchema.extend({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// host.status / host.start / host.stop
// ---------------------------------------------------------------------------

/** Host lifecycle state. "running" means a host job (e.g. a migration) is in progress. */
export const HostStateSchema = z.enum(["idle", "running", "stopping"]);

/**
 * Host lifecycle status. `phase` is host-specific free text; AgenticMigrator
 * uses preparing | migrating | verifying | done | failed | stopped. After a
 * job finishes, `state` returns to "idle" while `phase`/`extensionId` keep the
 * terminal state of the last job until the next start.
 */
export const HostStatusSchema = z.object({
  state: HostStateSchema,
  extensionId: z.string().nullable(),
  phase: z.string().nullable(),
  startedAt: z.string().nullable(),
  message: z.string().nullable(),
});

/** Which extension to start a host job (migration) for. */
export const HostStartParamsSchema = z.object({ id: ExtensionIdSchema });

// ---------------------------------------------------------------------------
// host.log
// ---------------------------------------------------------------------------

/** Captured host log stream: stdout (info) or stderr (errors). */
export const LogStreamSchema = z.enum(["stdout", "stderr"]);

/** One captured host log line. */
export const LogLineSchema = z.object({
  /** Monotonic per-run line number. The client asks for lines with seq > offset. */
  seq: z.number().int().positive(),
  /** ISO timestamp when the line was captured, or null when unknown. */
  ts: z.string().nullable(),
  stream: LogStreamSchema,
  text: z.string(),
});

/** Params for host.log. `offset` is the last seq the client already has. */
export const HostLogParamsSchema = z
  .object({
    offset: z.number().int().nonnegative().default(0),
  })
  .default({});

export const HostLogResultSchema = z.object({
  lines: z.array(LogLineSchema),
  /** Largest seq emitted so far. Pass it back as the next `offset`. */
  nextOffset: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Method registry
// ---------------------------------------------------------------------------

/** Params + result schema per method. `params: undefined` means no params. */
export const MethodsSchema = {
  ping: { params: undefined, result: PingResultSchema },
  "extensions.list": { params: ListParamsSchema, result: ListResultSchema },
  "extensions.get": {
    params: z.object({ id: ExtensionIdSchema }),
    result: z.object({ extension: ExtensionProfileSchema }),
  },
  "extensions.files": {
    params: z.object({ id: ExtensionIdSchema }),
    result: z.object({ files: FileRefsSchema }),
  },
  "reports.get": {
    params: z.object({ extensionId: ExtensionIdSchema }),
    result: z.object({ report: ReportSchema.nullable() }),
  },
  "reports.submit": {
    params: z.object({ report: ReportDraftSchema }),
    result: z.object({ id: z.string().min(1) }),
  },
  "host.status": {
    params: undefined,
    result: z.object({ status: HostStatusSchema }),
  },
  "host.start": {
    params: HostStartParamsSchema,
    result: z.object({ status: HostStatusSchema }),
  },
  "host.startAll": {
    params: undefined,
    result: z.object({ status: HostStatusSchema }),
  },
  "host.stop": {
    params: undefined,
    result: z.object({ status: HostStatusSchema }),
  },
  "host.log": {
    params: HostLogParamsSchema,
    result: HostLogResultSchema,
  },
} as const;

export type MethodName = keyof typeof MethodsSchema;

/** Methods documented in PROTOCOL.md as NOT implemented in v1. */
export const FutureMethods = ["analysis.rerun", "db.query"] as const;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNKNOWN_EXTENSION: 404,
  /** A host job (migration) is already running. */
  HOST_BUSY: 409,
} as const;
