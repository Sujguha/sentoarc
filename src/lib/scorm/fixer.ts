import type { Unzipped } from "fflate";
import { findEntryCaseInsensitive, strToU8, buildZip } from "./zip-utils";
import { serializeManifest } from "./manifest-parser";
import { validatePackage, TITLE_MAX_LENGTH, type ValidationIssue } from "./validator";

export interface PackageIssue extends ValidationIssue {
  fixApplied: boolean;
}

export type PackageStatus = "pass" | "fixed" | "failed";

export interface FixResult {
  status: PackageStatus;
  issues: PackageIssue[];
  scormVersionIn: string | null;
  scormVersionOut: string | null;
  fixedZip: Uint8Array | null;
}

const SCORM_1_2_NAMESPACES: Record<string, string> = {
  "@_xmlns": "http://www.imsproject.org/xsd/imscp_rootv1p1p2",
  "@_xmlns:adlcp": "http://www.adlnet.org/xsd/adlcp_rootv1p2",
};
const SCORM_2004_ONLY_NAMESPACE_ATTRS = ["@_xmlns:adlseq", "@_xmlns:adlnav", "@_xmlns:imsss"];

function getOrganizationsArray(raw: any): any[] {
  return raw?.manifest?.organizations?.organization ?? [];
}

function getResourcesArray(raw: any): any[] {
  return raw?.manifest?.resources?.resource ?? [];
}

function hasErrorSeverity(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function fixPackage(files: Unzipped): FixResult {
  const validation = validatePackage(files);
  const { manifest, manifestPath, issues: baseIssues, directlyReferencedResourceIds } = validation;

  const packageIsBroken = manifest === null || hasErrorSeverity(baseIssues);

  if (packageIsBroken) {
    return {
      status: "failed",
      issues: baseIssues.map((i) => ({ ...i, fixApplied: false })),
      scormVersionIn: manifest?.scormVersion ?? null,
      scormVersionOut: null,
      fixedZip: null,
    };
  }

  // manifest/manifestPath are non-null here (packageIsBroken is false).
  const raw: any = manifest!.raw;
  const resultIssues: PackageIssue[] = [];
  let anyFixApplied = false;
  let scormVersionOut = manifest!.scormVersion;

  for (const issue of baseIssues) {
    let fixApplied = false;

    switch (issue.code) {
      case "SCORM_2004_CONVERTIBLE": {
        Object.assign(raw.manifest, SCORM_1_2_NAMESPACES);
        for (const attr of SCORM_2004_ONLY_NAMESPACE_ATTRS) delete raw.manifest[attr];
        if (raw.manifest.metadata) raw.manifest.metadata.schemaversion = "1.2";
        scormVersionOut = "1.2";
        fixApplied = true;
        break;
      }

      case "SCORMTYPE_ASSET_SHOULD_BE_SCO":
      case "SCORMTYPE_MISSING": {
        const match = issue.message.match(/Resource "([^"]+)"/);
        const resourceId = match?.[1];
        const resource = getResourcesArray(raw).find((r: any) => r["@_identifier"] === resourceId);
        if (resource) {
          delete resource["@_adlcp:scormType"];
          resource["@_adlcp:scormtype"] = "sco";
          fixApplied = true;
        }
        break;
      }

      case "LAUNCH_FILE_CASE_MISMATCH": {
        const match = issue.message.match(/Resource "([^"]+)"/);
        const resourceId = match?.[1];
        const resource = getResourcesArray(raw).find((r: any) => r["@_identifier"] === resourceId);
        if (resource?.["@_href"]) {
          const corrected = findEntryCaseInsensitive(files, resource["@_href"]);
          if (corrected) {
            const originalHref = resource["@_href"];
            resource["@_href"] = corrected;
            for (const f of resource.file ?? []) {
              if (typeof f["@_href"] === "string" && f["@_href"].toLowerCase() === originalHref.toLowerCase()) {
                f["@_href"] = corrected;
              }
            }
            fixApplied = true;
          }
        }
        break;
      }

      case "TITLE_TOO_LONG": {
        for (const org of getOrganizationsArray(raw)) {
          if (typeof org.title === "string" && org.title.length > TITLE_MAX_LENGTH) {
            org.title = org.title.slice(0, TITLE_MAX_LENGTH);
            fixApplied = true;
          }
        }
        break;
      }

      // DUPLICATE_RESOURCE_IDENTIFIER, MANIFEST_IDENTIFIER_MISSING, SCORM_VERSION_UNKNOWN:
      // left as reported-but-unfixed — renaming a duplicate identifier is only
      // safe when nothing references it, which the manifest alone can't prove.
      default:
        break;
    }

    if (fixApplied) anyFixApplied = true;
    resultIssues.push({ ...issue, fixApplied });
  }

  if (!anyFixApplied) {
    return {
      status: "pass",
      issues: resultIssues,
      scormVersionIn: manifest!.scormVersion,
      scormVersionOut,
      fixedZip: buildZip(toFileRecord(files)),
    };
  }

  const newManifestXml = serializeManifest(raw);
  const outputFiles = toFileRecord(files);
  outputFiles[manifestPath!] = strToU8(newManifestXml);

  return {
    status: "fixed",
    issues: resultIssues,
    scormVersionIn: manifest!.scormVersion,
    scormVersionOut,
    fixedZip: buildZip(outputFiles),
  };
}

function toFileRecord(files: Unzipped): Record<string, Uint8Array> {
  return { ...files };
}
