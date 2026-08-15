import type { Manifest, SourceFile } from "./types.js";

/**
 * Extension size. Port of the v0 ExtPorter size-calculator. Sums UTF-8 byte
 * lengths of all file contents plus the serialized manifest.
 */

export interface SizeResult {
  sizeBytes: number;
  /** Size in hundreds of KB, floored (the v0 scoring dimension). */
  extensionSize: number;
}

export function calculateSize(manifest: Manifest | undefined, files: SourceFile[]): SizeResult {
  let totalSize = 0;

  for (const file of files) {
    totalSize += Buffer.byteLength(file.content, "utf8");
  }

  if (manifest) {
    totalSize += Buffer.byteLength(JSON.stringify(manifest), "utf8");
  }

  const sizeKB = totalSize / 1024;
  return { sizeBytes: totalSize, extensionSize: Math.floor(sizeKB / 100) };
}
