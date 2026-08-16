/**
 * Pure extension analyzer. analyzeExtension(source) -> AnalysisProfile.
 *
 * Port of the v0 ExtPorter interestingness scorer as pure functions. The v0
 * design mutated Extension objects inside a migration pipeline; here the input
 * is an immutable ExtensionSource and the output is a fresh AnalysisProfile.
 * No mutation, no logger, no pipeline coupling. The migration-signal breakdown
 * dimensions stay at 0; hosts with existing analysis fill them at the adapter
 * layer.
 */
import { analyzeFiles } from "./file-analyzer.js";
import { tagExtension } from "./feature-tagger.js";
import { resolveManifestStrings } from "./i18n.js";
import { extractListeners } from "./listener-extractor.js";
import { analyzeManifest } from "./manifest-analyzer.js";
import { emptyBreakdown, scoreBreakdown, type ScoreBreakdown } from "./scoring.js";
import { calculateSize } from "./size.js";
import type { AnalysisProfile, ExtensionSource } from "./types.js";

export { DANGEROUS_PERMISSIONS, WEIGHTS } from "./scoring.js";
export type { ScoreBreakdown } from "./scoring.js";
export { extractListeners } from "./listener-extractor.js";
export { extensionIdFromKey, resolveManifestStrings } from "./i18n.js";
export type { AnalysisProfile, ExtensionSource, Listener, Manifest, SourceFile } from "./types.js";

export function analyzeExtension(source: ExtensionSource): AnalysisProfile {
  const breakdown: ScoreBreakdown = emptyBreakdown();

  const fileCounts = analyzeFiles(source.files);
  breakdown.webRequest = fileCounts.webRequest;
  breakdown.htmlLines = fileCounts.htmlLines;
  breakdown.storageLocal = fileCounts.storageLocal;
  breakdown.cryptoPatterns = fileCounts.cryptoPatterns;
  breakdown.networkRequests = fileCounts.networkRequests;

  const manifestCounts = analyzeManifest(source.manifest);
  breakdown.backgroundPage = manifestCounts.backgroundPage;
  breakdown.contentScripts = manifestCounts.contentScripts;
  breakdown.dangerousPermissions = manifestCounts.dangerousPermissions;
  breakdown.hostPermissions = manifestCounts.hostPermissions;

  const { sizeBytes, extensionSize } = calculateSize(source.manifest, source.files);
  breakdown.extensionSize = extensionSize;

  const tags = tagExtension(source.manifest, breakdown, source.files);
  const listeners = extractListeners(source.files);
  const score = scoreBreakdown(breakdown);

  const manifestVersion =
    typeof source.manifest.manifest_version === "number" ? source.manifest.manifest_version : 2;
  const resolved = resolveManifestStrings(source.manifest, source.files);
  const name = typeof source.manifest.name === "string" ? resolved.name : source.id;
  const version = typeof source.manifest.version === "string" ? source.manifest.version : null;

  return {
    id: source.id,
    name,
    version,
    manifestVersion,
    score,
    breakdown,
    tags,
    listeners,
    sizeBytes,
  };
}
