import { afterAll, describe, expect, test } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createFolderBackend, discoverExtensions, extensionIdFromPath } from "../src/folder.js";
import { createExtlensServer } from "../src/index.js";
import type { Backend } from "../src/backend.js";

const fixtures = join(import.meta.dirname, "..", "..", "..", "fixtures");
const corpus = join(fixtures, "corpus-a");
const scratchDb = join(fixtures, ".folder-test.sqlite");

function makeBackend(): Backend {
  return createFolderBackend(corpus, { dbPath: scratchDb });
}

afterAll(() => {
  if (existsSync(scratchDb)) {
    try {
      unlinkSync(scratchDb);
    } catch {
      // Windows keeps the file locked briefly; harmless.
    }
  }
});

describe("discovery", () => {
  test("finds extension roots and derives stable ids", () => {
    const roots = discoverExtensions(corpus);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    for (const root of roots) {
      expect(extensionIdFromPath(root)).toMatch(/^[0-9a-f]{64}$/);
      expect(extensionIdFromPath(root)).toBe(extensionIdFromPath(root));
    }
  });

  test("treats a single extension dir as its own corpus", () => {
    const single = join(fixtures, "one-ext");
    expect(discoverExtensions(single).length).toBe(1);
  });
});

describe("FolderBackend", () => {
  test("lists extensions with stats from SQL", async () => {
    const backend = makeBackend();
    const res = await backend.listExtensions({ page: 1, pageSize: 50, sort: "interestingness_desc" });
    expect(res.extensions.length).toBeGreaterThanOrEqual(2);
    expect(res.extensions[0]).toMatchObject({ hasMv3: false, score: expect.any(Number) });
    expect(res.stats.total).toBe(res.extensions.length);
    expect(res.stats.withMv3).toBe(0);
    expect(res.totalPages).toBe(1);
  });

  test("searches name and id host-side", async () => {
    const backend = makeBackend();
    const all = await backend.listExtensions({ page: 1, pageSize: 50, sort: "name" });
    const names = new Set(all.extensions.map((e) => e.name));
    // "minimal" and "webpack-bundled" fixtures; search should match by name.
    const hit = await backend.listExtensions({ page: 1, pageSize: 50, sort: "name", search: "minimal" });
    expect(hit.extensions.length).toBeGreaterThan(0);
    expect([...hit.extensions].every((e) => names.has(e.name))).toBe(true);
    expect(hit.stats.total).toBeLessThanOrEqual(all.stats.total);
  });

  test("paginates with offsets", async () => {
    const backend = makeBackend();
    const all = await backend.listExtensions({ page: 1, pageSize: 50, sort: "name" });
    const first = await backend.listExtensions({ page: 1, pageSize: 1, sort: "name" });
    const second = await backend.listExtensions({ page: 2, pageSize: 1, sort: "name" });
    expect(first.extensions.length).toBe(1);
    expect(second.extensions.length).toBe(1);
    expect(second.extensions[0]!.id).not.toBe(first.extensions[0]!.id);
    expect(all.extensions.length).toBeGreaterThan(1);
  });

  test("serves full profiles without re-reading files", async () => {
    const backend = makeBackend();
    const list = await backend.listExtensions({ page: 1, pageSize: 1, sort: "name" });
    const got = await backend.getExtension(list.extensions[0]!.id);
    expect(got).not.toBeNull();
    if (!got?.profile?.manifest) throw new Error("expected a profile");
    expect(got.profile.id).toBe(list.extensions[0]!.id);
    expect(got.profile.name).toBe(list.extensions[0]!.name);
    expect(got.profile.manifest.name).toBe(got.profile.name);
    expect(got.profile.score).toBe(list.extensions[0]!.score);
  });

  test("returns 404 for unknown ids", async () => {
    const backend = makeBackend();
    expect(await backend.getExtension("missing")).toBeNull();
    expect(await backend.getFiles("missing")).toBeNull();
  });

  test("serves file refs for the folder", async () => {
    const backend = makeBackend();
    const list = await backend.listExtensions({ page: 1, pageSize: 1, sort: "name" });
    const files = await backend.getFiles(list.extensions[0]!.id);
    expect(files).not.toBeNull();
    const ref = files!.mv2 ?? files!.mv3;
    expect(ref).toMatch(/^file:\/\//);
  });

  test("round-trips reports", async () => {
    const backend = makeBackend();
    const before = await backend.listExtensions({ page: 1, pageSize: 1, sort: "name" });
    const id = before.extensions[0]!.id;
    expect(before.extensions[0]!.hasReport).toBe(false);
    expect(await backend.getReport(id)).toBeNull();
    const draft = {
      extensionId: id,
      tested: true,
      verificationDurationSecs: null,
      installs: true,
      worksInMv2: true,
      needsLogin: false,
      isPopupWorking: null,
      isSettingsWorking: null,
      isNewTabWorking: null,
      isInteresting: true,
      overallWorking: "yes" as const,
      notes: "folder mode",
      listeners: [],
    };
    expect(await backend.submitReport(draft)).toBe(id);
    const after = await backend.listExtensions({ page: 1, pageSize: 1, sort: "name" });
    expect(after.extensions[0]!.id).toBe(id);
    expect(after.extensions[0]!.hasReport).toBe(true);
    const report = await backend.getReport(id);
    expect(report).toMatchObject({ id, extensionId: id, tested: true, notes: "folder mode" });
    expect(report!.createdAt).toBe(report!.updatedAt);
  });
});

describe("folder backend over the wire", () => {
  test("serves list, get, and report methods over WebSocket", async () => {
    const backend = makeBackend();
    const server = createExtlensServer({ port: 0, backend });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const pending = new Map<number, (msg: unknown) => void>();
    const nextId = { n: 0 };
    const call = (method: string, params?: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++nextId.n;
        pending.set(id, (msg) => {
          const m = msg as { error?: unknown; result?: unknown };
          if (m.error) reject(new Error(JSON.stringify(m.error)));
          else resolve(m.result);
        });
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { id: number };
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    const list = (await call("extensions.list", { page: 1, pageSize: 5, sort: "name" })) as {
      extensions: { id: string; name: string }[];
      stats: { total: number };
    };
    expect(list.extensions.length).toBeGreaterThan(0);
    expect(list.stats.total).toBeGreaterThan(0);
    const first = list.extensions[0]!;
    const got = (await call("extensions.get", { id: first.id })) as {
      extension: { name: string; score: number };
    };
    expect(got.extension.name).toBe(first.name);
    expect(got.extension.score).toBeGreaterThan(0);
    const files = (await call("extensions.files", { id: first.id })) as {
      files: { mv2?: string; mv3?: string };
    };
    expect(files.files.mv2 ?? files.files.mv3).toMatch(/^file:\/\//);
    const submitted = (await call("reports.submit", {
      report: {
        extensionId: first.id,
        tested: false,
        verificationDurationSecs: null,
        installs: false,
        worksInMv2: false,
        needsLogin: null,
        isPopupWorking: null,
        isSettingsWorking: null,
        isNewTabWorking: null,
        isInteresting: null,
        overallWorking: "no",
        notes: "wire",
        listeners: [],
      },
    })) as { id: string };
    expect(submitted.id).toBe(first.id);
    await server.close();
    ws.close();
  });
});
