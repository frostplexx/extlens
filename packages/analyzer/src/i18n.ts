/**
 * i18n message resolution and Chrome extension id derivation.
 *
 * Manifests may reference localized strings as __MSG_<key>__; the values
 * live in _locales/<locale>/messages.json. Extension ids derive from the
 * manifest `key` field, a base64-encoded DER SubjectPublicKeyInfo.
 */
import { createHash } from "node:crypto";
import type { Manifest, SourceFile } from "./types.js";

const MSG_PATTERN = /__MSG_([A-Za-z0-9_@]+)__/g;

function parseMessagesFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const entry = value as { message?: unknown } | null;
      if (entry && typeof entry === "object" && typeof entry.message === "string") {
        out[key] = entry.message;
      }
    }
  } catch {
    // A malformed messages.json is ignored; the raw string stays.
  }
  return out;
}

/** Load every _locales/<locale>/messages.json as { messageKey: value }. */
export function loadLocaleMessages(
  files: SourceFile[],
): Record<string, Record<string, string>> {
  const locales: Record<string, Record<string, string>> = {};
  for (const file of files) {
    const match = /^_locales\/([^/]+)\/messages\.json$/.exec(file.path);
    if (match) locales[match[1]!] = parseMessagesFile(file.content);
  }
  return locales;
}

function resolve(raw: string, messages: Record<string, string>): string {
  return raw.replace(MSG_PATTERN, (match, key: string) => messages[key] ?? match);
}

/** Pick the display locale: default_locale, else en, else the first found. */
function pickLocale(
  manifest: Manifest,
  locales: Record<string, Record<string, string>>,
): Record<string, string> {
  const preferred =
    typeof manifest.default_locale === "string" && locales[manifest.default_locale]
      ? manifest.default_locale
      : "en";
  return locales[preferred] ?? Object.values(locales)[0] ?? {};
}

/** Resolve __MSG_...__ placeholders in the manifest name and description. */
export function resolveManifestStrings(
  manifest: Manifest,
  files: SourceFile[],
): { name: string; description: string | null } {
  const messages = pickLocale(manifest, loadLocaleMessages(files));
  const name = typeof manifest.name === "string" ? manifest.name : "";
  const description = typeof manifest.description === "string" ? manifest.description : null;
  return {
    name: resolve(name, messages),
    description: description === null ? null : resolve(description, messages),
  };
}

/**
 * Chrome extension id from the manifest `key`: base16 of the first 16 bytes
 * of SHA-256 over the decoded DER key, mapped to a-p. Returns null when the
 * key is absent or malformed (unpacked extensions have no stable id).
 */
export function extensionIdFromKey(key: unknown): string | null {
  if (typeof key !== "string" || key.length === 0) return null;
  try {
    const der = Buffer.from(key, "base64");
    if (der.length === 0) return null;
    const digest = createHash("sha256").update(der).digest();
    let id = "";
    for (let i = 0; i < 16; i++) {
      id += String.fromCharCode(97 + ((digest[i] ?? 0) >> 4));
      id += String.fromCharCode(97 + ((digest[i] ?? 0) & 0x0f));
    }
    return id;
  } catch {
    return null;
  }
}
