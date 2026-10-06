import { strToU8 } from "fflate";
import { buildZip } from "../../src/lib/scorm/zip-utils";

import valid12 from "../fixtures/manifests/valid-1.2.xml?raw";
import scorm2004 from "../fixtures/manifests/scorm-2004.xml?raw";
import assetScormtype from "../fixtures/manifests/asset-scormtype.xml?raw";
import missingLaunchFile from "../fixtures/manifests/missing-launch-file.xml?raw";
import nestedFolders from "../fixtures/manifests/nested-folders.xml?raw";
import translationPathMismatch from "../fixtures/manifests/translation-path-mismatch.xml?raw";
import translationAssetMissing from "../fixtures/manifests/translation-asset-missing.xml?raw";

export const FIXTURE_MANIFESTS = {
  "valid-1.2": valid12,
  "scorm-2004": scorm2004,
  "asset-scormtype": assetScormtype,
  "missing-launch-file": missingLaunchFile,
  "nested-folders": nestedFolders,
  "translation-path-mismatch": translationPathMismatch,
  "translation-asset-missing": translationAssetMissing,
} as const;

export type FixtureName = keyof typeof FIXTURE_MANIFESTS;

// Builds a minimal in-memory ZIP: the named fixture manifest plus stub
// (non-empty, content-irrelevant) files at the given paths.
export function buildFixtureZip(manifestName: FixtureName, filePaths: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "imsmanifest.xml": strToU8(FIXTURE_MANIFESTS[manifestName]),
  };
  for (const path of filePaths) {
    files[path] = strToU8(`<html><body>stub: ${path}</body></html>`);
  }
  return buildZip(files);
}

// Corrupts a valid ZIP's actual compressed data while leaving its
// central directory (at the end of the file) untouched -- a
// header-only scan (listZipEntries, which is all file-type detection
// does) still reads it fine, so it's classified normally, but actually
// inflating any entry throws. Simulates a truncated/corrupted upload
// that survives being classified as "this looks like a zip" and only
// breaks once something really tries to decompress it.
export function corruptCompressedData(zip: Uint8Array): Uint8Array {
  const corrupted = new Uint8Array(zip);
  const localHeaderIndex = corrupted.findIndex(
    (b, i) => b === 0x50 && corrupted[i + 1] === 0x4b && corrupted[i + 2] === 0x03 && corrupted[i + 3] === 0x04
  );
  if (localHeaderIndex === -1) {
    throw new Error("corruptCompressedData: no local file header found in input");
  }
  // Central directory file header signature -- flipping bytes past this
  // point would corrupt the structure listZipEntries itself depends on,
  // which is the opposite of what this helper is for (a zip that still
  // *looks* parseable but fails to actually decompress).
  const centralDirIndex = corrupted.findIndex(
    (b, i) =>
      i > localHeaderIndex && b === 0x50 && corrupted[i + 1] === 0x4b && corrupted[i + 2] === 0x01 && corrupted[i + 3] === 0x02
  );
  const dataStart = localHeaderIndex + 40; // past the fixed 30-byte header + a typical short name/extra field
  const safeLimit = (centralDirIndex === -1 ? corrupted.length : centralDirIndex) - 5;
  // A narrow window is enough to break deflate decoding (corrupts the
  // Huffman-coded stream) without reaching into the central directory
  // even for a small fixture -- a wide window risks doing both at once,
  // which makes listZipEntries itself throw and defeats the point.
  const dataEnd = Math.min(dataStart + 20, safeLimit);
  if (dataEnd <= dataStart) {
    throw new Error("corruptCompressedData: input too small to corrupt safely -- give it a larger fixture");
  }
  for (let i = dataStart; i < dataEnd; i++) {
    corrupted[i] = (corrupted[i] ?? 0) ^ 0xff;
  }
  return corrupted;
}
