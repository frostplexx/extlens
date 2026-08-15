import type { SourceFile } from "./types.js";

/**
 * Pattern counts in JS and HTML files. Port of the v0 ExtPorter file-analyzer.
 * Pure: takes files, returns counts.
 */

export interface FileCounts {
  webRequest: number;
  htmlLines: number;
  storageLocal: number;
  cryptoPatterns: number;
  networkRequests: number;
}

const CRYPTO_PATTERNS = [
  /eval\(/g,
  /Function\(/g,
  /btoa\(/g,
  /atob\(/g,
  /crypto\./g,
];

const NETWORK_PATTERNS = [/fetch\(/g, /XMLHttpRequest/g, /\.ajax\(/g];

function countPattern(content: string, pattern: RegExp): number {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

export function analyzeFiles(files: SourceFile[]): FileCounts {
  let webRequest = 0;
  let htmlLines = 0;
  let storageLocal = 0;
  let cryptoPatterns = 0;
  let networkRequests = 0;

  for (const file of files) {
    if (file.type === "html") {
      htmlLines += file.content.split("\n").length;
      continue;
    }
    if (file.type !== "js") continue;

    webRequest += countPattern(file.content, /webRequest/g);
    storageLocal += countPattern(file.content, /storage\.local/g);
    for (const pattern of CRYPTO_PATTERNS) {
      cryptoPatterns += countPattern(file.content, pattern);
    }
    for (const pattern of NETWORK_PATTERNS) {
      networkRequests += countPattern(file.content, pattern);
    }
  }

  return { webRequest, htmlLines, storageLocal, cryptoPatterns, networkRequests };
}
