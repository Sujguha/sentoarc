import type { Unzipped } from "fflate";
import { findEntryCaseInsensitive, readEntryText } from "./zip-utils";
import {
  parseManifest,
  ManifestParseError,
  collectDirectlyReferencedIdentifiers,
  type ParsedManifest,
} from "./manifest-parser";

export type IssueSeverity = "info" | "warning" | "error";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  manifest: ParsedManifest | null;
  manifestPath: string | null;
  issues: ValidationIssue[];
  directlyReferencedResourceIds: Set<string>;
}

export const TITLE_MAX_LENGTH = 250;

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function validatePackage(files: Unzipped): ValidationResult {
  const issues: ValidationIssue[] = [];

  const manifestPath = findEntryCaseInsensitive(files, "imsmanifest.xml");
  if (!manifestPath) {
    issues.push({
      severity: "error",
      code: "MANIFEST_MISSING",
      message: "No imsmanifest.xml found at the package root.",
    });
    return { manifest: null, manifestPath: null, issues, directlyReferencedResourceIds: new Set() };
  }

  const xml = readEntryText(files, manifestPath)!;

  let manifest: ParsedManifest;
  try {
    manifest = parseManifest(xml);
  } catch (err) {
    if (err instanceof ManifestParseError) {
      issues.push({ severity: "error", code: "MANIFEST_PARSE_ERROR", message: err.message });
      return { manifest: null, manifestPath, issues, directlyReferencedResourceIds: new Set() };
    }
    throw err;
  }

  if (!manifest.identifier) {
    issues.push({
      severity: "warning",
      code: "MANIFEST_IDENTIFIER_MISSING",
      message: "Manifest is missing an identifier attribute.",
    });
  }

  if (manifest.organizations.length === 0) {
    issues.push({ severity: "error", code: "NO_ORGANIZATIONS", message: "Manifest has no <organization> defined." });
  }
  if (manifest.resources.length === 0) {
    issues.push({ severity: "error", code: "NO_RESOURCES", message: "Manifest has no <resource> defined." });
  }
  if (manifest.organizations.length === 0 || manifest.resources.length === 0) {
    return { manifest, manifestPath, issues, directlyReferencedResourceIds: new Set() };
  }

  if (manifest.scormVersion === "unknown") {
    issues.push({
      severity: "warning",
      code: "SCORM_VERSION_UNKNOWN",
      message: "Could not determine SCORM version from schemaversion/xmlns.",
    });
  } else if (manifest.scormVersion === "2004") {
    if (manifest.usesSequencing) {
      issues.push({
        severity: "error",
        code: "SCORM_2004_SEQUENCING_UNSUPPORTED",
        message:
          "Package uses SCORM 2004 sequencing/navigation features and cannot be safely converted to SCORM 1.2. Manual rebuild in SEN required.",
      });
    } else {
      issues.push({
        severity: "warning",
        code: "SCORM_2004_CONVERTIBLE",
        message: "Package is SCORM 2004 but uses no 2004-only features; will be converted to SCORM 1.2.",
      });
    }
  }

  const directlyReferencedResourceIds = collectDirectlyReferencedIdentifiers(manifest.organizations);

  const seenResourceIds = new Set<string>();
  for (const res of manifest.resources) {
    if (seenResourceIds.has(res.identifier)) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_RESOURCE_IDENTIFIER",
        message: `Duplicate resource identifier "${res.identifier}".`,
      });
    }
    seenResourceIds.add(res.identifier);
  }

  for (const res of manifest.resources) {
    const isDirectlyReferenced = directlyReferencedResourceIds.has(res.identifier);
    if (!isDirectlyReferenced) continue; // scormtype only affects tracking for the launched resource

    if (res.scormType?.toLowerCase() === "asset") {
      issues.push({
        severity: "warning",
        code: "SCORMTYPE_ASSET_SHOULD_BE_SCO",
        message: `Resource "${res.identifier}" is directly launched by an item but marked scormtype="asset"; completion will not track. Will be changed to "sco".`,
      });
    } else if (!res.scormType) {
      issues.push({
        severity: "warning",
        code: "SCORMTYPE_MISSING",
        message: `Resource "${res.identifier}" is directly launched but has no adlcp:scormtype set. Will be set to "sco".`,
      });
    }
  }

  for (const res of manifest.resources) {
    if (!res.href) continue;
    const found = findEntryCaseInsensitive(files, res.href);
    if (!found) {
      issues.push({
        severity: "error",
        code: "LAUNCH_FILE_MISSING",
        message: `Resource "${res.identifier}" references launch file "${res.href}" which was not found in the package.`,
      });
    } else if (found !== res.href) {
      issues.push({
        severity: "warning",
        code: "LAUNCH_FILE_CASE_MISMATCH",
        message: `Resource "${res.identifier}" references "${res.href}" but the file in the package is "${found}" (case mismatch). Will be corrected.`,
      });
    }
  }

  for (const org of manifest.organizations) {
    if (org.title && org.title.length > TITLE_MAX_LENGTH) {
      issues.push({
        severity: "info",
        code: "TITLE_TOO_LONG",
        message: `Organization title exceeds ${TITLE_MAX_LENGTH} characters and will be truncated.`,
      });
    }
  }

  return { manifest, manifestPath, issues, directlyReferencedResourceIds };
}
