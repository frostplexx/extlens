/**
 * Why did this migration fail? Asked of a model, with the evidence a reviewer would use.
 *
 * The report is the centre of the prompt. A verdict of "not working" is a person's observation —
 * the popup opened blank, the settings page did nothing — and the model's job is to account for
 * *that*, from the code, not to review the migration in the abstract. So the surface results and
 * the reviewer's notes go first, the manifests second, and the diff of what the migration changed
 * last, as the place to look for the cause.
 *
 * Hosts assemble the inputs (they know where their files are) and call `explain`; the SDK owns
 * the prompt so every host produces comparable explanations.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import {
  SURFACE_LABELS,
  type ExplainResult,
  type ExtensionProfile,
  type ManifestSummary,
  type Report,
} from "@extlens/protocol";
import type { SourceFile } from "@extlens/analyzer";

export interface ExplainInput {
  profile: ExtensionProfile;
  /** The reviewer's report. Without one there is no failure to explain, only a migration to review. */
  report: Report | null;
  /** Source of each variant, when the host has it. Paths are relative to the extension root. */
  mv2?: SourceFile[];
  mv3?: SourceFile[];
  /**
   * Anything else the host knows that a reviewer would want the model to see — a migrator's own
   * verification result, runtime errors it captured, the agent's stated reason for a change.
   * Rendered as titled sections after the report.
   */
  context?: { title: string; text: string }[];
}

export interface ExplainerOptions {
  /** Defaults to ANTHROPIC_API_KEY. */
  apiKey?: string;
  model?: string;
  /** Upper bound on the prompt's diff section, in characters. Bundles are big; context is not free. */
  maxDiffChars?: number;
  /** Test seam: replace the API call. */
  complete?: (system: string, user: string, model: string) => Promise<string>;
}

export interface Explainer {
  explain(input: ExplainInput): Promise<ExplainResult>;
  readonly model: string;
}

export const DEFAULT_EXPLAIN_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_DIFF_CHARS = 120_000;
/** A single file's patch beyond this is a minified bundle, and its diff is noise. */
const MAX_FILE_PATCH_CHARS = 30_000;

const SYSTEM = `You are helping a reviewer understand why a Chrome extension stopped working after an automated Manifest V2 → Manifest V3 migration.

You are given, in order: the reviewer's report (which user-facing surfaces they tested, what they saw, and their notes), any extra context the host has (such as the migrator's own automated verification and captured runtime errors), the analyzer's summary of both manifests, and a unified diff of what the migration changed. The report is the ground truth of what is broken; the code is where the cause is.

Write for that reviewer, in Markdown, under 300 words:

1. **Likely cause** — one or two sentences naming the concrete change (or missing change) that explains what the reviewer observed. Cite files and, where useful, the relevant line of the diff.
2. **Evidence** — the specific facts in the report and the diff that support it. Where the report and the code disagree, say so.
3. **What would fix it** — the smallest change that would plausibly restore the behaviour.

If the evidence does not support a confident cause, say what is uncertain and what to check next instead of guessing. Do not restate the whole diff. Do not pad.`;

function manifestBlock(label: string, m: ManifestSummary): string {
  const background =
    m.background === null ? "none" : `${m.background.type}: ${m.background.scripts.join(", ") || "(none)"}`;
  const scripts =
    m.contentScripts.length === 0
      ? "none"
      : m.contentScripts.map((cs) => `${cs.matches.join(" | ")} → js[${cs.js.join(", ")}] css[${cs.css.join(", ")}]`).join("\n    ");
  return [
    `### ${label}`,
    `- background: ${background}`,
    `- permissions: ${m.permissions.join(", ") || "none"}`,
    `- host permissions: ${m.hostPermissions.join(", ") || "none"}`,
    `- content scripts: ${scripts}`,
    `- popup: ${m.action?.defaultPopup ?? "none"}`,
    `- options page: ${m.optionsPage ?? "none"}`,
    `- new tab override: ${m.chromeUrlOverrides.newtab ?? "none"}`,
  ].join("\n");
}

function yesNo(value: boolean | null): string {
  return value === null ? "not answered" : value ? "yes" : "no";
}

function reportBlock(profile: ExtensionProfile, report: Report | null): string {
  if (!report) {
    return "No report has been filed for this extension yet. Explain what in the migration is most likely to break, and which surface a reviewer should test first.";
  }
  const lines: string[] = [];
  lines.push(`- verdict: **${report.verdict ?? report.overallWorking ?? "not recorded"}**`);
  if (report.score !== null) lines.push(`- preserved-behaviour score: ${report.score}`);
  lines.push(`- installs: ${yesNo(report.installs)}; works in MV2: ${yesNo(report.worksInMv2)}; needs login: ${yesNo(report.needsLogin)}`);
  if (report.surfaces.length > 0) {
    lines.push("- surfaces tested:");
    for (const s of report.surfaces) {
      const label = SURFACE_LABELS[s.surface] ?? s.surface;
      lines.push(`  - ${label}: **${s.status}**${s.note ? ` — "${s.note}"` : ""}`);
    }
  } else {
    lines.push(
      `- legacy fields — popup working: ${yesNo(report.isPopupWorking)}; settings working: ${yesNo(report.isSettingsWorking)}; new tab working: ${yesNo(report.isNewTabWorking)}`,
    );
  }
  const detected = profile.surfaces.map((s) => `${SURFACE_LABELS[s.surface] ?? s.surface} (${s.evidence})`);
  if (detected.length > 0) lines.push(`- surfaces the analyzer detected: ${detected.join("; ")}`);
  lines.push(`- reviewer's notes: ${report.notes.trim() ? `\n\n${report.notes.trim()}` : "(none)"}`);
  return lines.join("\n");
}

function listenerBlock(profile: ExtensionProfile): string {
  if (profile.listeners.length === 0) return "";
  const rows = profile.listeners.slice(0, 60).map((l) => `- ${l.api} — ${l.file}:${l.line}`);
  return `\n## Event listeners and UI-creating calls the analyzer found (in the ${profile.manifestVersion === 2 ? "MV2" : "MV3"} source)\n${rows.join("\n")}`;
}

function isTextFile(f: SourceFile): boolean {
  return f.type !== "other" || /\.(json|md|txt|xml|svg)$/i.test(f.path);
}

/**
 * Unified diff of every text file that differs, changed manifest first, then by patch size —
 * small, targeted edits are more often the cause than the bundle that got re-minified.
 */
export function diffSources(mv2: SourceFile[] = [], mv3: SourceFile[] = [], maxChars = DEFAULT_MAX_DIFF_CHARS): string {
  const before = new Map(mv2.filter(isTextFile).map((f) => [f.path, f.content]));
  const after = new Map(mv3.filter(isTextFile).map((f) => [f.path, f.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const patches: { path: string; text: string }[] = [];
  for (const path of paths) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b) continue;
    let text = createTwoFilesPatch(`mv2/${path}`, `mv3/${path}`, a ?? "", b ?? "", undefined, undefined, { context: 3 });
    if (text.length > MAX_FILE_PATCH_CHARS) {
      text = `${text.slice(0, MAX_FILE_PATCH_CHARS)}\n... (patch truncated: ${text.length} chars; likely a bundle)\n`;
    }
    patches.push({ path, text });
  }
  patches.sort((x, y) => {
    if (x.path === "manifest.json") return -1;
    if (y.path === "manifest.json") return 1;
    return x.text.length - y.text.length;
  });
  let out = "";
  let omitted = 0;
  for (const p of patches) {
    if (out.length + p.text.length > maxChars) {
      omitted += 1;
      continue;
    }
    out += p.text + "\n";
  }
  if (omitted > 0) out += `\n... ${omitted} more changed file(s) omitted for length.\n`;
  return out;
}

export function buildPrompt(input: ExplainInput, maxDiffChars = DEFAULT_MAX_DIFF_CHARS): string {
  const { profile, report, mv2, mv3 } = input;
  const parts: string[] = [];
  parts.push(`# ${profile.name} v${profile.version ?? "?"}`);
  if (profile.manifest.description) parts.push(profile.manifest.description);
  parts.push(`\n## Reviewer's report\n${reportBlock(profile, report)}`);

  for (const section of input.context ?? []) {
    const text = section.text.trim();
    if (text) parts.push(`\n## ${section.title}\n${text.slice(0, 8000)}`);
  }

  const mv2Summary = profile.mv2 ?? (profile.manifestVersion === 2 ? profile.manifest : null);
  const mv3Summary = profile.manifestVersion === 3 ? profile.manifest : null;
  parts.push("\n## Manifests");
  if (mv2Summary) parts.push(manifestBlock("MV2 (before)", mv2Summary));
  if (mv3Summary) parts.push(manifestBlock("MV3 (after)", mv3Summary));
  if (!mv2Summary && !mv3Summary) parts.push("(no manifest summary available)");

  parts.push(listenerBlock(profile));

  if (mv2 && mv3) {
    const diff = diffSources(mv2, mv3, maxDiffChars);
    parts.push(`\n## What the migration changed (unified diff, MV2 → MV3)\n\n${diff.trim() ? "```diff\n" + diff + "```" : "(no textual differences between the two trees)"}`);
  } else {
    const only = mv3 ?? mv2;
    const label = mv3 ? "MV3" : "MV2";
    if (only) {
      const files = only.filter(isTextFile).slice(0, 20).map((f) => `- ${f.path} (${f.content.length} chars)`);
      parts.push(`\n## Source\nOnly the ${label} tree is available, so there is no diff. Files:\n${files.join("\n")}`);
      const manifest = only.find((f) => f.path === "manifest.json");
      const background = only.filter((f) => f.type === "js").sort((x, y) => x.content.length - y.content.length)[0];
      for (const f of [manifest, background].filter((f): f is SourceFile => Boolean(f))) {
        parts.push(`\n### ${f.path}\n\`\`\`\n${f.content.slice(0, 12_000)}\n\`\`\``);
      }
    } else {
      parts.push("\n## Source\n(not available to this host)");
    }
  }
  return parts.join("\n");
}

export function createExplainer(options: ExplainerOptions = {}): Explainer {
  const model = options.model ?? process.env.EXTLENS_EXPLAIN_MODEL ?? DEFAULT_EXPLAIN_MODEL;
  const maxDiffChars = options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
  const complete =
    options.complete ??
    (async (system: string, user: string, model: string): Promise<string> => {
      const client = new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model,
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: user }],
      });
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    });
  return {
    model,
    async explain(input) {
      const explanation = await complete(SYSTEM, buildPrompt(input, maxDiffChars), model);
      return { explanation, model };
    },
  };
}

/** True when a host can build an explainer without being handed a key. */
export function explainerConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
