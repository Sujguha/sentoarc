import { describe, expect, it } from "vitest";
import { safeUnzip, buildZip } from "../../src/lib/scorm/zip-utils";
import { validatePackage, hasErrors } from "../../src/lib/scorm/validator";
import { buildFixtureZip } from "./helpers";

function unzipFixture(name: Parameters<typeof buildFixtureZip>[0], files: string[]) {
  return safeUnzip(buildFixtureZip(name, files)).files;
}

describe("validatePackage", () => {
  it("valid-1.2: no issues at all", () => {
    const files = unzipFixture("valid-1.2", ["index.html"]);
    const result = validatePackage(files);
    expect(result.issues).toEqual([]);
    expect(hasErrors(result.issues)).toBe(false);
  });

  it("scorm-2004 (with sequencing): reports an unfixable error", () => {
    const files = unzipFixture("scorm-2004", ["index.html"]);
    const result = validatePackage(files);
    expect(hasErrors(result.issues)).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("SCORM_2004_SEQUENCING_UNSUPPORTED");
  });

  it("asset-scormtype: flags the directly-referenced asset as fixable", () => {
    const files = unzipFixture("asset-scormtype", ["index.html"]);
    const result = validatePackage(files);
    expect(hasErrors(result.issues)).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("SCORMTYPE_ASSET_SHOULD_BE_SCO");
  });

  it("missing-launch-file: reports an unfixable error", () => {
    const files = unzipFixture("missing-launch-file", []); // no files at all, launch file absent
    const result = validatePackage(files);
    expect(hasErrors(result.issues)).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("LAUNCH_FILE_MISSING");
  });

  it("nested-folders: resolves nested launch/file paths with no issues", () => {
    const files = unzipFixture("nested-folders", [
      "content/lesson1/index.html",
      "content/lesson1/style.css",
      "content/shared/common.js",
    ]);
    const result = validatePackage(files);
    expect(result.issues).toEqual([]);
  });

  it("reports MANIFEST_MISSING when imsmanifest.xml is absent", () => {
    const result = validatePackage(safeUnzip(buildZip({})).files);
    expect(result.issues[0]!.code).toBe("MANIFEST_MISSING");
  });
});
