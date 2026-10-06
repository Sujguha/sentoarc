import { describe, expect, it } from "vitest";
import { buildZip, listZipEntries } from "../../src/lib/scorm/zip-utils";
import { validatePackage, hasErrors, type ValidatePackageOptions } from "../../src/lib/scorm/validator";
import { buildFixtureZip } from "./helpers";

function validateFixture(
  name: Parameters<typeof buildFixtureZip>[0],
  files: string[],
  options: ValidatePackageOptions = {}
) {
  const data = buildFixtureZip(name, files);
  const names = listZipEntries(data).entries.map((e) => e.name);
  return validatePackage(data, names, options);
}

describe("validatePackage", () => {
  it("valid-1.2: no issues at all", () => {
    const result = validateFixture("valid-1.2", ["index.html"]);
    expect(result.issues).toEqual([]);
    expect(hasErrors(result.issues)).toBe(false);
  });

  it("scorm-2004 (with sequencing): reports an unfixable error", () => {
    const result = validateFixture("scorm-2004", ["index.html"]);
    expect(hasErrors(result.issues)).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("SCORM_2004_SEQUENCING_UNSUPPORTED");
  });

  it("asset-scormtype: flags the directly-referenced asset as fixable", () => {
    const result = validateFixture("asset-scormtype", ["index.html"]);
    expect(hasErrors(result.issues)).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("SCORMTYPE_ASSET_SHOULD_BE_SCO");
  });

  it("missing-launch-file: reports an unfixable error", () => {
    const result = validateFixture("missing-launch-file", []); // no files at all, launch file absent
    expect(hasErrors(result.issues)).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("LAUNCH_FILE_MISSING");
  });

  it("nested-folders: resolves nested launch/file paths with no issues", () => {
    const result = validateFixture("nested-folders", [
      "content/lesson1/index.html",
      "content/lesson1/style.css",
      "content/shared/common.js",
    ]);
    expect(result.issues).toEqual([]);
  });

  it("reports MANIFEST_MISSING when imsmanifest.xml is absent", () => {
    const data = buildZip({});
    const result = validatePackage(data, listZipEntries(data).entries.map((e) => e.name));
    expect(result.issues[0]!.code).toBe("MANIFEST_MISSING");
  });

  describe("translation path checks (checkTranslationPaths: true)", () => {
    it("ignores translated-asset paths when the option is off (default)", () => {
      const result = validateFixture("translation-path-mismatch", ["index.html", "en-us/narration.mp3"]);
      expect(result.issues.map((i) => i.code)).not.toContain("TRANSLATION_PATH_MISMATCH");
    });

    it("flags a case-mismatched translated asset as fixable", () => {
      const result = validateFixture(
        "translation-path-mismatch",
        ["index.html", "en-us/narration.mp3"],
        { checkTranslationPaths: true }
      );
      expect(hasErrors(result.issues)).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain("TRANSLATION_PATH_MISMATCH");
    });

    it("does not flag a translated asset whose path matches exactly", () => {
      const result = validateFixture(
        "translation-path-mismatch",
        ["index.html", "en-US/narration.mp3"],
        { checkTranslationPaths: true }
      );
      expect(result.issues.map((i) => i.code)).not.toContain("TRANSLATION_PATH_MISMATCH");
    });

    it("reports an unfixable error when a translated asset is entirely missing", () => {
      const result = validateFixture("translation-asset-missing", ["index.html"], { checkTranslationPaths: true });
      expect(hasErrors(result.issues)).toBe(true);
      expect(result.issues.map((i) => i.code)).toContain("TRANSLATION_ASSET_MISSING");
    });
  });
});
