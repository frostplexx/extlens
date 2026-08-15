import { DANGEROUS_PERMISSIONS } from "./scoring.js";
import type { Manifest } from "./types.js";

/**
 * Manifest-derived signals: background, content scripts, dangerous and host
 * permissions. Port of the v0 ExtPorter manifest-analyzer.
 */

export interface ManifestCounts {
  backgroundPage: number;
  contentScripts: number;
  dangerousPermissions: number;
  hostPermissions: number;
}

export function analyzeManifest(manifest: Manifest | undefined): ManifestCounts {
  if (!manifest) {
    return { backgroundPage: 0, contentScripts: 0, dangerousPermissions: 0, hostPermissions: 0 };
  }

  let backgroundPage = 0;
  if (manifest.background || manifest.service_worker) backgroundPage = 1;

  let contentScripts = 0;
  if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
    contentScripts = 1;
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const dangerousPermissions = permissions.filter(
    (perm): perm is string => typeof perm === "string" && DANGEROUS_PERMISSIONS.has(perm),
  ).length;

  let hostPermissions = 0;
  for (const perm of permissions) {
    if (typeof perm === "string" && (perm.includes("://") || perm.startsWith("*"))) {
      hostPermissions++;
    }
  }
  const hostPermissionsField = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions
    : [];
  hostPermissions += hostPermissionsField.length;

  return { backgroundPage, contentScripts, dangerousPermissions, hostPermissions };
}
