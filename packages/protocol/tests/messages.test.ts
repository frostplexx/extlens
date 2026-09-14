import { describe, expect, test } from "vitest";
import {
  ErrorEnvelopeSchema,
  ExtensionIdSchema,
  ExtensionLightSchema,
  ExtensionProfileSchema,
  FileRefsSchema,
  HostLogParamsSchema,
  HostStartParamsSchema,
  HostStatusSchema,
  ListParamsSchema,
  ListResultSchema,
  MethodsSchema,
  PingResultSchema,
  ReportDraftSchema,
  ReportSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
} from "../src/index.js";

const light = {
  id: "abc123",
  name: "Example",
  version: "1.0.0",
  manifestVersion: 2,
  score: 74,
  tags: ["HAS_BROWSER_POPUP", "USES_WEB_REQUEST"],
  hasMv3: true,
  hasReport: false,
};

const breakdown = {
  webRequest: 2,
  htmlLines: 40,
  storageLocal: 3,
  backgroundPage: 1,
  contentScripts: 1,
  dangerousPermissions: 4,
  hostPermissions: 1,
  cryptoPatterns: 2,
  networkRequests: 3,
  extensionSize: 0,
  apiRenames: 0,
  manifestChanges: 0,
  fileModifications: 0,
  webRequestToDnr: 0,
};

const profile = {
  id: "abc123",
  name: "Example",
  version: "1.0.0",
  manifestVersion: 2,
  score: 74,
  breakdown,
  tags: ["HAS_BROWSER_POPUP"],
  listeners: [
    {
      api: "chrome.runtime.onMessage",
      file: "background.js",
      line: 1,
      snippet: "chrome.runtime.onMessage.addListener(...)",
    },
  ],
  manifest: {
    manifestVersion: 2,
    name: "Example",
    version: "1.0.0",
    description: "An example",
    permissions: ["tabs", "storage"],
    hostPermissions: ["*://*.example.com/*"],
    background: { type: "page", scripts: ["background.js"] },
    contentScripts: [{ matches: ["https://*/*"], js: ["content.js"], css: [] }],
    action: { defaultPopup: "popup.html", defaultTitle: "Example" },
    optionsPage: "options.html",
    chromeUrlOverrides: { newtab: null },
  },
  sizeBytes: 12345,
  hasMv3: false,
};

describe("envelope", () => {
  test("parses a valid request", () => {
    const req = { jsonrpc: "2.0", id: 1, method: "extensions.list", params: { page: 2 } };
    expect(RequestEnvelopeSchema.parse(req)).toEqual(req);
  });

  test("parses a request without params", () => {
    const req = { jsonrpc: "2.0", id: "a", method: "ping" };
    expect(RequestEnvelopeSchema.parse(req)).toEqual(req);
  });

  test("rejects a request with wrong jsonrpc version", () => {
    expect(() =>
      RequestEnvelopeSchema.parse({ jsonrpc: "1.0", id: 1, method: "ping" }),
    ).toThrow();
  });

  test("parses a success response", () => {
    const res = { jsonrpc: "2.0", id: 1, result: { ok: true } };
    expect(ResponseEnvelopeSchema.parse(res)).toEqual(res);
  });

  test("parses an error response", () => {
    const res = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: 404, message: "unknown extension id: xyz" },
    };
    expect(ErrorEnvelopeSchema.parse(res)).toEqual(res);
  });
});

describe("extensions.list params", () => {
  test("defaults empty params", () => {
    expect(ListParamsSchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
      sort: "interestingness_desc",
    });
  });

  test("accepts explicit values", () => {
    expect(
      ListParamsSchema.parse({ page: 3, pageSize: 10, search: "tab", sort: "name" }),
    ).toEqual({ page: 3, pageSize: 10, search: "tab", sort: "name" });
  });

  test("rejects page 0", () => {
    expect(() => ListParamsSchema.parse({ page: 0 })).toThrow();
  });

  test("rejects pageSize over 200", () => {
    expect(() => ListParamsSchema.parse({ pageSize: 201 })).toThrow();
  });

  test("rejects an unknown sort value", () => {
    expect(() => ListParamsSchema.parse({ sort: "bogus" })).toThrow();
  });
});

describe("extensions.list result", () => {
  test("round-trips a light and stats", () => {
    const result = {
      extensions: [light],
      stats: { total: 1, analyzed: 1, withMv3: 1, avgScore: 74 },
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
    expect(ListResultSchema.parse(result)).toEqual(result);
  });

  test("accepts a full page of 200", () => {
    const result = {
      extensions: Array.from({ length: 200 }, () => light),
      stats: { total: 1, analyzed: 1, withMv3: 1, avgScore: 74 },
      page: 1,
      pageSize: 200,
      totalPages: 1,
    };
    expect(ListResultSchema.parse(result).extensions).toHaveLength(200);
  });

  test("rejects a page over 200 rows", () => {
    expect(() =>
      ListResultSchema.parse({
        extensions: Array.from({ length: 201 }, () => light),
        stats: { total: 1, analyzed: 1, withMv3: 1, avgScore: 74 },
        page: 1,
        pageSize: 200,
        totalPages: 1,
      }),
    ).toThrow();
  });

  test("rejects a light without a score", () => {
    expect(() => ExtensionLightSchema.parse({ ...light, score: undefined })).toThrow();
  });

  test("rejects a light without hasReport", () => {
    const { hasReport: _hasReport, ...missing } = light;
    expect(() => ExtensionLightSchema.parse(missing)).toThrow();
  });
});

describe("extensions.get result", () => {
  test("round-trips a profile", () => {
    // `surfaces` defaults in for a profile written before surface detection existed.
    expect(ExtensionProfileSchema.parse(profile)).toEqual({ ...profile, surfaces: [] });
  });

  test("round-trips the extensions.get result wrapper", () => {
    expect(MethodsSchema["extensions.get"].result.parse({ extension: profile })).toEqual({
      extension: { ...profile, surfaces: [] },
    });
  });

  test("rejects a profile with a missing breakdown field", () => {
    const bad = { ...profile, breakdown: { ...breakdown, webRequest: undefined } };
    expect(() => ExtensionProfileSchema.parse(bad)).toThrow();
  });
});

describe("extensions.files result", () => {
  test("round-trips mv2-only refs", () => {
    const files = { mv2: "file:///host/exts/abc/" };
    expect(FileRefsSchema.parse(files)).toEqual(files);
  });

  test("round-trips mv2+mv3 refs", () => {
    const files = {
      mv2: "file:///host/exts/abc/",
      mv3: "file:///host/exts/abc/mv3/",
    };
    expect(FileRefsSchema.parse(files)).toEqual(files);
  });

  test("accepts refs without mv2 (host has no MV2 source)", () => {
    expect(FileRefsSchema.parse({ mv3: "file:///x" })).toEqual({ mv3: "file:///x" });
  });

  test("rejects an empty mv2 ref", () => {
    expect(() => FileRefsSchema.parse({ mv2: "" })).toThrow();
  });
});

describe("reports", () => {
  const draft = {
    extensionId: "abc123",
    tested: true,
    verificationDurationSecs: 10,
    installs: true,
    worksInMv2: true,
    needsLogin: true,
    isPopupWorking: false,
    isSettingsWorking: true,
    isNewTabWorking: null,
    isInteresting: true,
    overallWorking: "could_not_test",
    notes: "looks good",
    listeners: [
      { api: "chrome.runtime.onMessage", file: "background.js", line: 1, status: "yes" },
      { api: "chrome.tabs.onUpdated", file: "background.js", line: 12, status: "untested" },
    ],
  };

  /** What a report written before per-surface results gains on re-validation. */
  const surfaceDefaults = { surfaces: [], verdict: null, score: null };

  test("round-trips a draft", () => {
    expect(ReportDraftSchema.parse(draft)).toEqual({ ...draft, ...surfaceDefaults });
  });

  test("round-trips a full report", () => {
    const report = {
      ...draft,
      id: "report-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    expect(ReportSchema.parse(report)).toEqual({ ...report, ...surfaceDefaults });
  });

  test("keeps a report carrying per-surface results intact", () => {
    const withSurfaces = {
      ...draft,
      surfaces: [
        { surface: "popup", status: "working", note: "" },
        { surface: "context_menu", status: "broken", note: "entry never appears" },
      ],
      verdict: "partially_working",
      score: 0.5,
    };
    expect(ReportDraftSchema.parse(withSurfaces)).toEqual(withSurfaces);
  });

  test("rejects a surface name the protocol does not define", () => {
    // A result row naming a surface the reader cannot enumerate is not analysable later.
    const bad = { ...draft, surfaces: [{ surface: "sidebar", status: "working", note: "" }] };
    expect(() => ReportDraftSchema.parse(bad)).toThrow();
  });

  test("rejects an unknown listener status", () => {
    const bad = {
      ...draft,
      listeners: [{ api: "x", file: "y", line: 1, status: "maybe" }],
    };
    expect(() => ReportDraftSchema.parse(bad)).toThrow();
  });
});

describe("ids and methods", () => {
  test("rejects an empty extension id", () => {
    expect(() => ExtensionIdSchema.parse("")).toThrow();
  });

  test("rejects a non-string extension id", () => {
    expect(() => ExtensionIdSchema.parse(42)).toThrow();
  });

  test("ping result validates", () => {
    expect(PingResultSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(() => PingResultSchema.parse({ ok: false })).toThrow();
  });

  test("every method has a result schema", () => {
    for (const [name, def] of Object.entries(MethodsSchema)) {
      expect(def.result, `missing result schema for ${name}`).toBeDefined();
    }
  });
});

describe("host lifecycle", () => {
  const status = {
    state: "running",
    extensionId: "mv2-b",
    phase: "migrating",
    startedAt: "2025-01-01T00:00:00.000Z",
    message: null,
  };

  test("round-trips a running status", () => {
    expect(HostStatusSchema.parse(status)).toEqual(status);
  });

  test("round-trips an idle status with the last job's terminal phase", () => {
    const idle = { state: "idle", extensionId: "mv2-b", phase: "failed", startedAt: null, message: "docker exploded" };
    expect(HostStatusSchema.parse(idle)).toEqual(idle);
  });

  test("rejects an unknown state", () => {
    expect(() => HostStatusSchema.parse({ ...status, state: "paused" })).toThrow();
  });

  test("host.status result wrapper parses", () => {
    expect(MethodsSchema["host.status"].result.parse({ status })).toEqual({ status });
  });

  test("host.start params require an id", () => {
    expect(HostStartParamsSchema.parse({ id: "mv2-b" })).toEqual({ id: "mv2-b" });
    expect(() => HostStartParamsSchema.parse({})).toThrow();
    expect(() => HostStartParamsSchema.parse({ id: "" })).toThrow();
  });

  test("host.stop takes no params", () => {
    expect(MethodsSchema["host.stop"].params).toBeUndefined();
  });

  test("host.startAll takes no params and returns a status", () => {
    expect(MethodsSchema["host.startAll"].params).toBeUndefined();
    expect(MethodsSchema["host.startAll"].result.parse({ status })).toEqual({ status });
  });

  test("host.log params default offset to 0 and reject negatives", () => {
    expect(HostLogParamsSchema.parse({})).toEqual({ offset: 0 });
    expect(HostLogParamsSchema.parse({ offset: 3 })).toEqual({ offset: 3 });
    expect(() => HostLogParamsSchema.parse({ offset: -1 })).toThrow();
  });

  test("host.log result round-trips lines and nextOffset", () => {
    const result = {
      lines: [{ seq: 1, ts: "2025-01-01T00:00:00.000Z", stream: "stderr", text: "boom" }],
      nextOffset: 1,
    };
    expect(MethodsSchema["host.log"].result.parse(result)).toEqual(result);
    expect(() =>
      MethodsSchema["host.log"].result.parse({
        lines: [{ seq: 0, ts: null, stream: "stdout", text: "" }],
        nextOffset: 0,
      }),
    ).toThrow();
  });
});
