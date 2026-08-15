import { analyzeExtension } from "@extlens/analyzer";
import type { ExtensionProfile, ManifestSummary } from "@extlens/protocol";
import type { ExtensionSource, Manifest } from "@extlens/analyzer";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Build the protocol ManifestSummary from a parsed manifest.json. */
export function summarizeManifest(manifest: Manifest): ManifestSummary {
  const backgroundRaw = obj(manifest.background);
  const serviceWorker =
    typeof backgroundRaw.service_worker === "string" ? backgroundRaw.service_worker : null;
  const backgroundScripts = strings(backgroundRaw.scripts);

  let background: ManifestSummary["background"] = null;
  if (serviceWorker) {
    background = { type: "service_worker", scripts: [serviceWorker] };
  } else if (backgroundScripts.length > 0) {
    background = { type: "page", scripts: backgroundScripts };
  }

  const contentScriptsRaw = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : [];

  const actionRaw = obj(
    manifest.action ?? manifest.browser_action ?? manifest.page_action,
  );

  const overrides = obj(manifest.chrome_url_overrides);

  return {
    manifestVersion: typeof manifest.manifest_version === "number" ? manifest.manifest_version : 2,
    name: typeof manifest.name === "string" ? manifest.name : "",
    version: typeof manifest.version === "string" ? manifest.version : null,
    description: typeof manifest.description === "string" ? manifest.description : null,
    permissions: strings(manifest.permissions),
    hostPermissions: strings(manifest.host_permissions),
    background,
    contentScripts: contentScriptsRaw.map((cs) => {
      const c = obj(cs);
      return { matches: strings(c.matches), js: strings(c.js), css: strings(c.css) };
    }),
    action: {
      defaultPopup:
        typeof actionRaw.default_popup === "string" ? actionRaw.default_popup : null,
      defaultTitle:
        typeof actionRaw.default_title === "string" ? actionRaw.default_title : null,
    },
    optionsPage: typeof manifest.options_page === "string" ? manifest.options_page : null,
    chromeUrlOverrides: {
      newtab: typeof overrides.newtab === "string" ? overrides.newtab : null,
    },
  };
}

/**
 * Default profile computation: run the analyzer over a source and map the
 * result onto the protocol ExtensionProfile shape.
 */
export function computeProfile(source: ExtensionSource): ExtensionProfile {
  const analysis = analyzeExtension(source);
  return {
    id: analysis.id,
    name: analysis.name,
    version: analysis.version,
    manifestVersion: analysis.manifestVersion,
    score: analysis.score,
    breakdown: analysis.breakdown,
    tags: analysis.tags,
    listeners: analysis.listeners,
    manifest: summarizeManifest(source.manifest),
    sizeBytes: analysis.sizeBytes,
    hasMv3: false,
  };
}

/**
 * Default get-extension flow: compute a profile from the host's files, then
 * let host-provided fields override. Used by the RPC layer when the backend
 * returns no profile.
 */
export function buildProfile(
  source: ExtensionSource,
  overrides: Partial<ExtensionProfile> | undefined,
): ExtensionProfile {
  const computed = computeProfile(source);
  return overrides ? { ...computed, ...overrides } : computed;
}
