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
