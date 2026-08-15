import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { ErrorCodes } from "@extlens/protocol";
import { startServer, type ExtlensServerHandle } from "../src/ws.js";
import { makeStubBackend } from "./stub-backend.js";

/** Real WebSocket integration: every protocol method over the wire. */

const handles: ExtlensServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

async function startTestServer() {
  const handle = startServer({ port: 0, backend: makeStubBackend() });
  handles.push(handle);
  return handle;
}

function request(socket: WebSocket, id: number, method: string, params?: unknown) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }));
  return new Promise<{ result?: unknown; error?: { code: number; message: string } }>((resolve) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        socket.off("message", onMessage);
        resolve(msg);
      }
    };
    socket.on("message", onMessage);
  });
}

async function connect(handle: ExtlensServerHandle): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${handle.port}`);
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  return socket;
}

describe("over the wire", () => {
  test("ping", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    expect(await request(socket, 1, "ping")).toEqual({ id: 1, jsonrpc: "2.0", result: { ok: true } });
  });

  test("extensions.list with defaults", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 2, "extensions.list", {});
    expect(res).toEqual({
      id: 2,
      jsonrpc: "2.0",
      result: { extensions: expect.any(Array), stats: expect.any(Object), page: 1, pageSize: 50, totalPages: 1 },
    });
  });

  test("extensions.get round trip", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 3, "extensions.get", { id: "one-ext" });
    expect(res.result).toEqual({ extension: expect.objectContaining({ id: "one-ext" }) });
  });

  test("extensions.files", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 4, "extensions.files", { id: "one-ext" });
    expect(res.result).toEqual({ files: { mv2: expect.stringContaining("file://") } });
  });

  test("reports round trip", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
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
      notes: "wire round trip",
      listeners: [],
    };
    const submit = await request(socket, 5, "reports.submit", { report: draft });
    expect(submit.result).toEqual({ id: "report-one-ext" });
    const get = await request(socket, 6, "reports.get", { extensionId: "one-ext" });
    expect(get.result).toEqual({ report: expect.objectContaining({ id: "report-one-ext", notes: "wire round trip" }) });
  });

  test("404 for unknown extension", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 7, "extensions.get", { id: "missing" });
    expect(res.error).toEqual({ code: ErrorCodes.UNKNOWN_EXTENSION, message: "unknown extension id: missing" });
  });

  test("invalid params", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 8, "extensions.list", { sort: "bogus" });
    expect(res.error?.code).toBe(ErrorCodes.INVALID_PARAMS);
  });

  test("unknown method", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    const res = await request(socket, 9, "extensions.wat");
    expect(res.error?.code).toBe(ErrorCodes.METHOD_NOT_FOUND);
  });

  test("malformed JSON -> parse error", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    socket.send("not json {");
    const res = await new Promise<{ error?: { code: number } }>((resolve) => {
      const onMessage = (raw: WebSocket.RawData) => {
        socket.off("message", onMessage);
        resolve(JSON.parse(raw.toString()));
      };
      socket.on("message", onMessage);
    });
    expect(res.error?.code).toBe(ErrorCodes.PARSE_ERROR);
  });

  test("malformed request -> invalid request", async () => {
    const handle = await startTestServer();
    const socket = await connect(handle);
    socket.send(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }));
    const res = await new Promise<{ error?: { code: number } }>((resolve) => {
      const onMessage = (raw: WebSocket.RawData) => {
        socket.off("message", onMessage);
        resolve(JSON.parse(raw.toString()));
      };
      socket.on("message", onMessage);
    });
    expect(res.error?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });
});
