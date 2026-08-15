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
});

export const ListStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  analyzed: z.number().int().nonnegative(),
  withMv3: z.number().int().nonnegative(),
  avgScore: z.number().nonnegative(),
});

export const ListResultSchema = z.object({
  extensions: z.array(ExtensionLightSchema),
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
  permissions: z.array(z.string()),
  hostPermissions: z.array(z.string()),
  background: BackgroundSummarySchema.nullable(),
  contentScripts: z.array(ContentScriptSummarySchema),
  action: ActionSummarySchema.nullable(),
  optionsPage: z.string().nullable(),
  chromeUrlOverrides: z.object({ newtab: z.string().nullable() }),
});

export const ExtensionProfileSchema = z.object({
  id: ExtensionIdSchema,
  name: z.string(),
  version: z.string().nullable(),
  manifestVersion: z.number().int().min(2).max(3),
  score: z.number().int(),
  breakdown: ScoreBreakdownSchema,
  tags: z.array(z.string()),
  listeners: z.array(ListenerSchema),
  manifest: ManifestSummarySchema,
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

/** Client -> host report payload. The host stamps id and timestamps. */
export const ReportDraftSchema = z.object({
  extensionId: ExtensionIdSchema,
  tested: z.boolean(),
  overallWorking: z.boolean().nullable(),
  hasErrors: z.boolean().nullable(),
  seemsSlower: z.boolean().nullable(),
  needsLogin: z.boolean().nullable(),
  isPopupBroken: z.boolean().nullable(),
  isSettingsBroken: z.boolean().nullable(),
  isInteresting: z.boolean().nullable(),
  notes: z.string(),
  listeners: z.array(ListenerTestResultSchema),
});

/** Full report as returned by reports.get. */
export const ReportSchema = ReportDraftSchema.extend({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
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
} as const;
