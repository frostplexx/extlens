import { describe, expect, test } from "vitest";
import {
  ErrorEnvelopeSchema,
  ExtensionIdSchema,
  ExtensionLightSchema,
  ExtensionProfileSchema,
  FileRefsSchema,
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

  test("rejects a light without a score", () => {
    expect(() => ExtensionLightSchema.parse({ ...light, score: undefined })).toThrow();
  });
});

describe("extensions.get result", () => {
  test("round-trips a profile", () => {
    expect(ExtensionProfileSchema.parse(profile)).toEqual(profile);
  });

  test("round-trips the extensions.get result wrapper", () => {
    expect(MethodsSchema["extensions.get"].result.parse({ extension: profile })).toEqual({
      extension: profile,
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
    overallWorking: true,
    hasErrors: false,
    seemsSlower: false,
    needsLogin: true,
    isPopupBroken: false,
    isSettingsBroken: false,
    isInteresting: true,
    notes: "looks good",
    listeners: [
      { api: "chrome.runtime.onMessage", file: "background.js", line: 1, status: "yes" },
      { api: "chrome.tabs.onUpdated", file: "background.js", line: 12, status: "untested" },
    ],
  };

  test("round-trips a draft", () => {
    expect(ReportDraftSchema.parse(draft)).toEqual(draft);
  });

  test("round-trips a full report", () => {
    const report = {
      ...draft,
      id: "report-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    expect(ReportSchema.parse(report)).toEqual(report);
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
