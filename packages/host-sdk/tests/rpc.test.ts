import { describe, expect, it, test } from "vitest";
import { ErrorCodes } from "@extlens/protocol";
import { dispatch, RpcError } from "../src/rpc.js";
import { makeStubBackend } from "./stub-backend.js";
import type { Backend } from "../src/backend.js";

function call(backend: unknown, method: string, params?: unknown) {
  return dispatch(backend as never, { id: 1, method, params });
}

describe("ping", () => {
  test("returns ok", async () => {
    expect(await call(makeStubBackend(), "ping")).toEqual({ result: { ok: true } });
  });
});

describe("extensions.list", () => {
  test("defaults params and returns lights + stats", async () => {
    const backend = makeStubBackend();
    const res = await call(backend, "extensions.list");
    expect(res).toEqual({
      result: {
        extensions: expect.arrayContaining([
          expect.objectContaining({ id: "one-ext", score: 78, tags: expect.any(Array) }),
        ]),
        stats: { total: 2, analyzed: 2, withMv3: 0, avgScore: expect.any(Number) },
        page: 1,
        pageSize: 50,
        totalPages: 1,
      },
    });
  });

  test("passes normalized params to the backend", async () => {
    let seen: unknown;
    const backend = {
      ...makeStubBackend(),
      async listExtensions(params: never) {
        seen = params;
        return (await makeStubBackend().listExtensions(params as never)) as never;
      },
    };
    await call(backend, "extensions.list", { sort: "name", pageSize: 5 });
    expect(seen).toEqual({ page: 1, pageSize: 5, sort: "name" });
  });

  test("rejects an invalid sort value", async () => {
    const res = await call(makeStubBackend(), "extensions.list", { sort: "bogus" });
    expect(res).toEqual({
      error: { code: ErrorCodes.INVALID_PARAMS, message: expect.stringContaining("invalid params") },
    });
  });
});

describe("extensions.get", () => {
  test("computes a profile for a known id", async () => {
    const res = await call(makeStubBackend(), "extensions.get", { id: "one-ext" });
    expect(res).toEqual({
      result: {
        extension: expect.objectContaining({
          id: "one-ext",
          name: "One Ext",
          score: 78,
          manifest: expect.objectContaining({ manifestVersion: 2 }),
        }),
      },
    });
  });

  test("host profile fields override computed ones", async () => {
    const backend = makeStubBackend();
    backend.getExtension = async (id) => {
      const got = await makeStubBackend().getExtension(id);
      return got ? { ...got, profile: { score: 999, hasMv3: true } } : null;
    };
    const res = await call(backend, "extensions.get", { id: "one-ext" });
    const result = res as { result: { extension: { score: number; hasMv3: boolean } } };
    expect(result.result.extension.score).toBe(999);
    expect(result.result.extension.hasMv3).toBe(true);
  });

  test("404 for an unknown id", async () => {
    const res = await call(makeStubBackend(), "extensions.get", { id: "nope" });
    expect(res).toEqual({
      error: { code: ErrorCodes.UNKNOWN_EXTENSION, message: "unknown extension id: nope" },
    });
  });
});

describe("extensions.files", () => {
  test("returns file references", async () => {
    const res = await call(makeStubBackend(), "extensions.files", { id: "one-ext" });
    expect(res).toEqual({ result: { files: { mv2: expect.stringContaining("file://") } } });
  });

  test("404 for an unknown id", async () => {
    const res = await call(makeStubBackend(), "extensions.files", { id: "nope" });
    expect(res).toEqual({ error: { code: ErrorCodes.UNKNOWN_EXTENSION, message: expect.any(String) } });
  });
});

describe("reports", () => {
  const draft = {
    extensionId: "one-ext",
    tested: true,
    verificationDurationSecs: 5,
    installs: true,
    worksInMv2: true,
    needsLogin: false,
    isPopupWorking: true,
    isSettingsWorking: null,
    isNewTabWorking: null,
    isInteresting: true,
    overallWorking: "yes",
    notes: "round trip",
    listeners: [{ api: "chrome.runtime.onMessage", file: "background.js", line: 1, status: "yes" }],
  };

  test("submit returns an id, get returns the stored report", async () => {
    const backend = makeStubBackend();
    const submit = await call(backend, "reports.submit", { report: draft });
    expect(submit).toEqual({ result: { id: "report-one-ext" } });

    const get = await call(backend, "reports.get", { extensionId: "one-ext" });
    expect(get).toEqual({
      result: {
        report: expect.objectContaining({
          id: "report-one-ext",
          extensionId: "one-ext",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      },
    });
  });

  test("get returns null before any submit", async () => {
    expect(await call(makeStubBackend(), "reports.get", { extensionId: "one-ext" })).toEqual({
      result: { report: null },
    });
  });

  test("rejects a report with an unknown listener status", async () => {
    const bad = { ...draft, listeners: [{ ...draft.listeners[0], status: "maybe" }] };
    const res = await call(makeStubBackend(), "reports.submit", { report: bad });
    expect(res).toEqual({ error: { code: ErrorCodes.INVALID_PARAMS, message: expect.any(String) } });
  });
});

describe("errors", () => {
  test("unknown method -> -32601", async () => {
    const res = await call(makeStubBackend(), "extensions.wat");
    expect(res).toEqual({ error: { code: ErrorCodes.METHOD_NOT_FOUND, message: "unknown method: extensions.wat" } });
  });

  test("documented future method -> -32601 with not-implemented message", async () => {
    const res = await call(makeStubBackend(), "analysis.rerun", { id: "x" });
    expect(res).toEqual({
      error: {
        code: ErrorCodes.METHOD_NOT_FOUND,
        message: "method analysis.rerun is documented but not implemented in protocol v1",
      },
    });
  });

  test("backend throwing -> -32603", async () => {
    const backend = makeStubBackend();
    backend.getReport = async () => {
      throw new Error("db exploded");
    };
    const res = await call(backend, "reports.get", { extensionId: "one-ext" });
    expect(res).toEqual({ error: { code: ErrorCodes.INTERNAL_ERROR, message: "db exploded" } });
  });

  test("RpcError from the backend maps to its code", async () => {
    const backend = makeStubBackend();
    backend.getReport = async () => {
      throw new RpcError(ErrorCodes.UNKNOWN_EXTENSION, "gone");
    };
    const res = await call(backend, "reports.get", { extensionId: "one-ext" });
    expect(res).toEqual({ error: { code: ErrorCodes.UNKNOWN_EXTENSION, message: "gone" } });
  });

  test("invalid backend result -> -32603", async () => {
    const backend = makeStubBackend();
    backend.listExtensions = async () => ({ extensions: [{ id: "x" }] }) as never;
    const res = await call(backend, "extensions.list");
    expect(res).toEqual({ error: { code: ErrorCodes.INTERNAL_ERROR, message: expect.any(String) } });
  });
});

describe("host.status / host.start / host.stop", () => {
  const running = {
    state: "running",
    extensionId: "mv2-b",
    phase: "migrating",
    startedAt: "2025-01-01T00:00:00.000Z",
    message: null,
  } as const;

  function hostBackend(overrides?: Partial<NonNullable<Backend["host"]>>) {
    const base = makeStubBackend();
    base.host = {
      async getStatus() {
        return { ...running };
      },
      async start(id) {
        if (id !== "mv2-b") throw new RpcError(ErrorCodes.UNKNOWN_EXTENSION, `unknown source extension: ${id}`);
        return { ...running };
      },
      async stop() {
        return { state: "idle", extensionId: null, phase: null, startedAt: null, message: null };
      },
      ...overrides,
    };
    return base;
  }

  test("host.status returns the controller status", async () => {
    const res = await call(hostBackend(), "host.status");
    expect(res).toEqual({ result: { status: running } });
  });

  test("host.start passes the id and returns status", async () => {
    const res = await call(hostBackend(), "host.start", { id: "mv2-b" });
    expect(res).toEqual({ result: { status: running } });
  });

  test("host.start with an unknown id -> 404", async () => {
    const res = await call(hostBackend(), "host.start", { id: "nope" });
    expect(res).toEqual({ error: { code: ErrorCodes.UNKNOWN_EXTENSION, message: expect.stringContaining("nope") } });
  });

  test("host.start while busy -> 409", async () => {
    const res = await call(
      hostBackend({
        async start() {
          throw new RpcError(ErrorCodes.HOST_BUSY, "migration already running for mv2-b");
        },
      }),
      "host.start",
      { id: "mv2-b" },
    );
    expect(res).toEqual({ error: { code: ErrorCodes.HOST_BUSY, message: expect.any(String) } });
  });

  test("host.stop returns the status", async () => {
    const res = await call(hostBackend(), "host.stop");
    expect(res).toEqual({ result: { status: { state: "idle", extensionId: null, phase: null, startedAt: null, message: null } } });
  });

  test("host.startAll calls the controller and returns the status", async () => {
    const res = await call(
      hostBackend({
        async startAll() {
          return { ...running, extensionId: "all" };
        },
      }),
      "host.startAll",
    );
    expect(res).toEqual({ result: { status: { ...running, extensionId: "all" } } });
  });

  test("host.startAll without a controller startAll -> -32601", async () => {
    const res = await call(hostBackend(), "host.startAll");
    expect(res).toEqual({ error: { code: ErrorCodes.METHOD_NOT_FOUND, message: expect.stringContaining("startAll") } });
  });

  test("backend without a host controller -> -32601", async () => {
    const backend = makeStubBackend();
    delete backend.host;
    const res = await call(backend, "host.status");
    expect(res).toEqual({ error: { code: ErrorCodes.METHOD_NOT_FOUND, message: expect.stringContaining("not supported") } });
  });

  test("invalid params -> -32602", async () => {
    const res = await call(hostBackend(), "host.start", { id: 42 });
    expect(res).toEqual({ error: { code: ErrorCodes.INVALID_PARAMS, message: expect.any(String) } });
  });

  test("host.log returns lines after the offset and nextOffset", async () => {
    const backend = hostBackend({
      async getLog(offset) {
        return {
          lines: [
            { seq: 3, ts: "t3", stream: "stdout", text: "third" },
            { seq: 4, ts: "t4", stream: "stderr", text: "fourth" },
          ],
          nextOffset: 4,
        };
      },
    });
    const res = await call(backend, "host.log", { offset: 2 });
    expect(res).toEqual({
      result: {
        lines: [
          { seq: 3, ts: "t3", stream: "stdout", text: "third" },
          { seq: 4, ts: "t4", stream: "stderr", text: "fourth" },
        ],
        nextOffset: 4,
      },
    });
  });

  test("host.log without a getLog controller returns empty", async () => {
    const res = await call(hostBackend(), "host.log", { offset: 5 });
    expect(res).toEqual({ result: { lines: [], nextOffset: 5 } });
  });

  test("host.log defaults offset to 0", async () => {
    let seen: unknown;
    const backend = hostBackend({
      async getLog(offset) {
        seen = offset;
        return { lines: [], nextOffset: 0 };
      },
    });
    await call(backend, "host.log");
    expect(seen).toEqual(0);
  });

  test("host.log without a host controller -> -32601", async () => {
    const backend = makeStubBackend();
    delete backend.host;
    const res = await call(backend, "host.log");
    expect(res).toEqual({ error: { code: ErrorCodes.METHOD_NOT_FOUND, message: expect.stringContaining("not supported") } });
  });
});

describe("results carry schema defaults", () => {
  /** A report as an older version stored it: no surfaces, verdict or score. */
  const legacyReport = {
    id: "r1",
    extensionId: "mv2-a",
    tested: true,
    verificationDurationSecs: null,
    installs: true,
    worksInMv2: true,
    needsLogin: false,
    isPopupWorking: null,
    isSettingsWorking: null,
    isNewTabWorking: null,
    isInteresting: false,
    overallWorking: "yes",
    notes: "",
    listeners: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("fills in fields a stored report predates, rather than passing it through raw", async () => {
    // The client trusts the schema and calls .map on surfaces; without this it gets undefined.
    const backend = { ...makeStubBackend(), getReport: async () => legacyReport as never } as Backend;
    const response = await dispatch(backend, { method: "reports.get", params: { extensionId: "mv2-a" } } as never);
    const report = (response as { result: { report: Record<string, unknown> } }).result.report;
    expect(report.surfaces).toEqual([]);
    expect(report.verdict).toBeNull();
    expect(report.score).toBeNull();
  });

  it("does the same for a bulk export, where one bad row would lose the corpus", async () => {
    const backend = {
      ...makeStubBackend(),
      listReports: async () => [{ name: "An Ext", report: legacyReport }] as never,
    } as Backend;
    const response = await dispatch(backend, { method: "reports.list", params: {} } as never);
    const rows = (response as { result: { reports: { report: Record<string, unknown> }[] } }).result.reports;
    expect(rows[0].report.surfaces).toEqual([]);
  });
});
