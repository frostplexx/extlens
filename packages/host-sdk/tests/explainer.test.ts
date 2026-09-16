/**
 * The explainer's value is in what it puts in front of the model, so that is what is pinned: the
 * report leads, the manifests follow, the diff is a real diff, and a host without a model says so
 * rather than failing on every call.
 */
import { describe, expect, it } from "vitest";
import { ErrorCodes, type ExtensionProfile, type Report } from "@extlens/protocol";
import { buildPrompt, createExplainer, diffSources } from "../src/explainer.js";
import { dispatch } from "../src/rpc.js";
import { makeStubBackend } from "./stub-backend.js";

const profile: ExtensionProfile = {
  id: "x",
  name: "One Ext",
  version: "1.0",
  manifestVersion: 3,
  score: 10,
  breakdown: {
    webRequest: 0,
    htmlLines: 0,
    storageLocal: 0,
    backgroundPage: 0,
    contentScripts: 0,
    dangerousPermissions: 0,
    hostPermissions: 0,
    cryptoPatterns: 0,
    networkRequests: 0,
    extensionSize: 0,
    apiRenames: 0,
    manifestChanges: 0,
    fileModifications: 0,
    webRequestToDnr: 0,
  },
  tags: [],
  listeners: [{ api: "chrome.runtime.onMessage", file: "background.js", line: 1, snippet: "", kind: "listener" }],
  surfaces: [{ surface: "popup", evidence: "action.default_popup: popup.html" }],
  manifest: {
    name: "One Ext",
    version: "1.0",
    manifestVersion: 3,
    description: null,
    permissions: ["storage"],
    hostPermissions: [],
    background: { type: "service_worker", scripts: ["background.js"] },
    contentScripts: [],
    action: { defaultPopup: "popup.html", defaultTitle: null },
    optionsPage: null,
    chromeUrlOverrides: { newtab: null },
  },
  mv2: {
    name: "One Ext",
    version: "1.0",
    manifestVersion: 2,
    description: null,
    permissions: ["storage", "webRequestBlocking"],
    hostPermissions: [],
    background: { type: "page", scripts: ["background.js"] },
    contentScripts: [],
    action: { defaultPopup: "popup.html", defaultTitle: null },
    optionsPage: null,
    chromeUrlOverrides: { newtab: null },
  },
  sizeBytes: 100,
  hasMv3: true,
};

const report: Report = {
  id: "r",
  createdAt: "",
  updatedAt: "",
  extensionId: "x",
  tested: true,
  verificationDurationSecs: 60,
  installs: true,
  worksInMv2: true,
  needsLogin: false,
  isPopupWorking: null,
  isSettingsWorking: null,
  isNewTabWorking: null,
  isInteresting: null,
  overallWorking: null,
  notes: "Popup opens but stays blank; console shows window.localStorage is undefined.",
  listeners: [],
  surfaces: [{ surface: "popup", status: "broken", note: "blank popup" }],
  verdict: "not_working",
  score: 0,
};

describe("buildPrompt", () => {
  it("leads with the reviewer's report, then manifests, then the diff", () => {
    const prompt = buildPrompt({
      profile,
      report,
      mv2: [{ path: "background.js", type: "js", content: "localStorage.x = 1;\n" }],
      mv3: [{ path: "background.js", type: "js", content: "chrome.storage.local.set({x: 1});\n" }],
    });
    const at = (s: string) => prompt.indexOf(s);
    expect(at("## Reviewer's report")).toBeGreaterThan(-1);
    expect(at("**not_working**")).toBeGreaterThan(at("## Reviewer's report"));
    expect(prompt).toContain('Popup window: **broken** — "blank popup"');
    expect(prompt).toContain("window.localStorage is undefined");
    expect(at("## Manifests")).toBeGreaterThan(at("## Reviewer's report"));
    expect(prompt).toContain("### MV2 (before)");
    expect(prompt).toContain("### MV3 (after)");
    expect(prompt).toContain("background: service_worker: background.js");
    expect(at("## What the migration changed")).toBeGreaterThan(at("## Manifests"));
    expect(prompt).toContain("-localStorage.x = 1;");
    expect(prompt).toContain("+chrome.storage.local.set({x: 1});");
  });

  it("places host context between the report and the manifests", () => {
    const prompt = buildPrompt({
      profile,
      report,
      context: [{ title: "Migrator verification", text: "runtime error: localStorage is not defined" }],
    });
    const at = (s: string) => prompt.indexOf(s);
    expect(at("## Migrator verification")).toBeGreaterThan(at("## Reviewer's report"));
    expect(at("## Migrator verification")).toBeLessThan(at("## Manifests"));
    expect(prompt).toContain("runtime error: localStorage is not defined");
  });

  it("says when there is no report rather than inventing one", () => {
    const prompt = buildPrompt({ profile, report: null, mv2: [], mv3: [] });
    expect(prompt).toContain("No report has been filed");
  });

  it("falls back to showing the single tree when there is nothing to diff", () => {
    const prompt = buildPrompt({
      profile,
      report,
      mv3: [{ path: "manifest.json", type: "other", content: "{}" }, { path: "bg.js", type: "js", content: "x" }],
    });
    expect(prompt).toContain("Only the MV3 tree is available");
    expect(prompt).toContain("### manifest.json");
  });
});

describe("diffSources", () => {
  it("skips identical files and puts the manifest first", () => {
    const diff = diffSources(
      [
        { path: "a.js", type: "js", content: "1" },
        { path: "manifest.json", type: "other", content: "{}" },
        { path: "same.js", type: "js", content: "s" },
      ],
      [
        { path: "a.js", type: "js", content: "2" },
        { path: "manifest.json", type: "other", content: "{ }" },
        { path: "same.js", type: "js", content: "s" },
      ],
    );
    expect(diff).not.toContain("same.js");
    expect(diff.indexOf("manifest.json")).toBeLessThan(diff.indexOf("a.js"));
  });

  it("stays under the budget by dropping the largest patches", () => {
    const big = "x".repeat(5000) + "\n";
    const diff = diffSources(
      [{ path: "big.js", type: "js", content: big }, { path: "small.js", type: "js", content: "a" }],
      [{ path: "big.js", type: "js", content: big + "y" }, { path: "small.js", type: "js", content: "b" }],
      1000,
    );
    expect(diff).toContain("small.js");
    expect(diff).toContain("1 more changed file(s) omitted");
  });
});

describe("createExplainer", () => {
  it("returns the model's text with the model name, through the seam", async () => {
    const seen: string[] = [];
    const explainer = createExplainer({
      model: "test-model",
      complete: async (system, user, model) => {
        seen.push(system, user, model);
        return "Because the service worker has no localStorage.";
      },
    });
    const out = await explainer.explain({ profile, report });
    expect(out).toEqual({ explanation: "Because the service worker has no localStorage.", model: "test-model" });
    expect(seen[0]).toContain("Likely cause");
    expect(seen[1]).toContain("blank popup");
  });
});

describe("analysis.explain over rpc", () => {
  it("is method-not-found on a host without an explainer", async () => {
    const res = await dispatch(makeStubBackend() as never, { id: 1, method: "analysis.explain", params: { extensionId: "one-ext" } });
    expect(res).toEqual({ error: { code: ErrorCodes.METHOD_NOT_FOUND, message: expect.stringMatching(/no model/) } });
  });

  it("relays the explanation when the backend offers one", async () => {
    const backend = { ...makeStubBackend(), explainFailure: async () => ({ explanation: "x", model: "m" }) };
    const res = await dispatch(backend as never, { id: 1, method: "analysis.explain", params: { extensionId: "one-ext" } });
    expect(res).toEqual({ result: { explanation: "x", model: "m" } });
  });
});
