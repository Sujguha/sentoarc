import { describe, expect, it } from "vitest";
import { strToU8, safeUnzip, buildZip } from "../../src/lib/scorm/zip-utils";
import { parseManifest } from "../../src/lib/scorm/manifest-parser";
import { fixPackage } from "../../src/lib/scorm/fixer";
import { buildFixtureZip } from "./helpers";

function unzipFixture(name: Parameters<typeof buildFixtureZip>[0], files: string[]) {
  return safeUnzip(buildFixtureZip(name, files)).files;
}

describe("fixPackage", () => {
  it("valid-1.2: status pass, no fixes needed, still produces a zip", () => {
    const files = unzipFixture("valid-1.2", ["index.html"]);
    const result = fixPackage(files);
    expect(result.status).toBe("pass");
    expect(result.scormVersionIn).toBe("1.2");
    expect(result.scormVersionOut).toBe("1.2");
    expect(result.fixedZip).not.toBeNull();
    expect(result.issues.every((i) => i.fixApplied === false)).toBe(true);
  });

  it("scorm-2004 with sequencing: status failed, no output zip", () => {
    const files = unzipFixture("scorm-2004", ["index.html"]);
    const result = fixPackage(files);
    expect(result.status).toBe("failed");
    expect(result.fixedZip).toBeNull();
    const seqIssue = result.issues.find((i) => i.code === "SCORM_2004_SEQUENCING_UNSUPPORTED");
    expect(seqIssue?.fixApplied).toBe(false);
  });

  it("asset-scormtype: status fixed, scormtype rewritten to sco in the output manifest", () => {
    const files = unzipFixture("asset-scormtype", ["index.html"]);
    const result = fixPackage(files);
    expect(result.status).toBe("fixed");
    expect(result.fixedZip).not.toBeNull();

    const fixedFiles = safeUnzip(result.fixedZip!).files;
    const rewritten = parseManifest(new TextDecoder().decode(fixedFiles["imsmanifest.xml"]));
    expect(rewritten.resources[0]!.scormType).toBe("sco");

    const issue = result.issues.find((i) => i.code === "SCORMTYPE_ASSET_SHOULD_BE_SCO");
    expect(issue?.fixApplied).toBe(true);
  });

  it("missing-launch-file: status failed, no output zip", () => {
    const files = unzipFixture("missing-launch-file", []);
    const result = fixPackage(files);
    expect(result.status).toBe("failed");
    expect(result.fixedZip).toBeNull();
  });

  it("nested-folders: status pass, nested paths preserved in the output zip", () => {
    const files = unzipFixture("nested-folders", [
      "content/lesson1/index.html",
      "content/lesson1/style.css",
      "content/shared/common.js",
    ]);
    const result = fixPackage(files);
    expect(result.status).toBe("pass");
    const fixedFiles = safeUnzip(result.fixedZip!).files;
    expect(Object.keys(fixedFiles).sort()).toEqual(
      ["content/lesson1/index.html", "content/lesson1/style.css", "content/shared/common.js", "imsmanifest.xml"].sort()
    );
  });

  it("SCORM 2004 WITHOUT sequencing: converted to 1.2, status fixed", () => {
    const manifestXml = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="COM.SCORM.2004.NOSEQ"
          version="1"
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>2004 Course, No Sequencing</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Lesson 1</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

    const zip = buildZip({
      "imsmanifest.xml": strToU8(manifestXml),
      "index.html": strToU8("<html></html>"),
    });
    const files = safeUnzip(zip).files;

    const result = fixPackage(files);
    expect(result.status).toBe("fixed");
    expect(result.scormVersionIn).toBe("2004");
    expect(result.scormVersionOut).toBe("1.2");

    const fixedFiles = safeUnzip(result.fixedZip!).files;
    const rewritten = parseManifest(new TextDecoder().decode(fixedFiles["imsmanifest.xml"]));
    expect(rewritten.scormVersion).toBe("1.2");
  });
});
