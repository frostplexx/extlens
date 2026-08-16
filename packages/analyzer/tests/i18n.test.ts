import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
  extensionIdFromKey,
  resolveManifestStrings,
} from "../src/i18n.js";
import type { Manifest, SourceFile } from "../src/types.js";

const file = (path: string, content: string): SourceFile => ({
  path,
  type: "other",
  content,
});

describe("i18n message resolution", () => {
  test("resolves __MSG__ from the en locale", () => {
    const manifest = {
      name: "__MSG_hivetips__",
      description: "D: __MSG_desc__",
    } as Manifest;
    const files = [
      file(
        "_locales/en/messages.json",
        JSON.stringify({
          hivetips: { message: "DeepAli - DeepLink Generator" },
          desc: { message: "Generate deep links" },
        }),
      ),
    ];
    expect(resolveManifestStrings(manifest, files)).toEqual({
      name: "DeepAli - DeepLink Generator",
      description: "D: Generate deep links",
    });
  });

  test("prefers default_locale over en", () => {
    const manifest = { default_locale: "de", name: "__MSG_n__" } as Manifest;
    const files = [
      file(
        "_locales/en/messages.json",
        JSON.stringify({ n: { message: "English" } }),
      ),
      file(
        "_locales/de/messages.json",
        JSON.stringify({ n: { message: "Deutsch" } }),
      ),
    ];
    expect(resolveManifestStrings(manifest, files).name).toBe("Deutsch");
  });

  test("keeps the raw string when the message key is missing", () => {
    const manifest = { name: "__MSG_missing__" } as Manifest;
    const files = [
      file(
        "_locales/en/messages.json",
        JSON.stringify({ other: { message: "x" } }),
      ),
    ];
    expect(resolveManifestStrings(manifest, files).name).toBe("__MSG_missing__");
  });

  test("ignores malformed messages.json", () => {
    const manifest = { name: "__MSG_n__" } as Manifest;
    const files = [file("_locales/en/messages.json", "not json")];
    expect(resolveManifestStrings(manifest, files).name).toBe("__MSG_n__");
  });
});

describe("extension id derivation", () => {
  test("derives the chrome id from the key", () => {
    const der = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const digest = createHash("sha256").update(der).digest();
    let expected = "";
    for (let i = 0; i < 16; i++) {
      expected += String.fromCharCode(97 + ((digest[i] ?? 0) >> 4));
      expected += String.fromCharCode(97 + ((digest[i] ?? 0) & 0x0f));
    }
    expect(extensionIdFromKey(der.toString("base64"))).toBe(expected);
    expect(expected).toMatch(/^[a-p]{32}$/);
  });

  test("returns null without a key", () => {
    expect(extensionIdFromKey(undefined)).toBeNull();
    expect(extensionIdFromKey("")).toBeNull();
    expect(extensionIdFromKey("%%%")).toBeNull();
  });
});
