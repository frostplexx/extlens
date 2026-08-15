import { describe, expect, test } from "vitest";
import { ErrorCodes } from "@extlens/protocol";
import { dispatch, RpcError } from "../src/rpc.js";
import { makeStubBackend } from "./stub-backend.js";

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
    overallWorking: true,
    hasErrors: false,
    seemsSlower: false,
    needsLogin: false,
    isPopupBroken: false,
    isSettingsBroken: false,
    isInteresting: true,
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
