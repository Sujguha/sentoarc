import { describe, expect, it } from "vitest";
import { strToU8, safeUnzip, buildZip, listZipEntries } from "../../src/lib/scorm/zip-utils";
import { parseManifest } from "../../src/lib/scorm/manifest-parser";
import { fixPackage } from "../../src/lib/scorm/fixer";
import { buildFixtureZip } from "./helpers";

function namesOf(data: Uint8Array): string[] {
  return listZipEntries(data).entries.map((e) => e.name);
}

async function toUint8Array(zip: Uint8Array | ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (zip === null) throw new Error("expected a fixedZip, got null");
  if (zip instanceof Uint8Array) return zip;
  const chunks: Uint8Array[] = [];
  const reader = zip.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe("fixPackage", () => {
  it("valid-1.2: status pass, no fixes needed, still produces a zip", () => {
    const data = buildFixtureZip("valid-1.2", ["index.html"]);
    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("pass");
    expect(result.scormVersionIn).toBe("1.2");
    expect(result.scormVersionOut).toBe("1.2");
    expect(result.fixedZip).not.toBeNull();
    // "pass" returns the original bytes verbatim -- no rebuild.
    expect(result.fixedZip).toBe(data);
    expect(result.issues.every((i) => i.fixApplied === false)).toBe(true);
  });

  it("scorm-2004 with sequencing: status failed, no output zip", () => {
    const data = buildFixtureZip("scorm-2004", ["index.html"]);
    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("failed");
    expect(result.fixedZip).toBeNull();
    const seqIssue = result.issues.find((i) => i.code === "SCORM_2004_SEQUENCING_UNSUPPORTED");
    expect(seqIssue?.fixApplied).toBe(false);
  });

  it("asset-scormtype: status fixed, scormtype rewritten to sco in the output manifest", async () => {
    const data = buildFixtureZip("asset-scormtype", ["index.html"]);
    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("fixed");
    expect(result.fixedZip).not.toBeNull();

    const fixedBytes = await toUint8Array(result.fixedZip);
    const fixedFiles = safeUnzip(fixedBytes).files;
    const rewritten = parseManifest(new TextDecoder().decode(fixedFiles["imsmanifest.xml"]));
    expect(rewritten.resources[0]!.scormType).toBe("sco");

    const issue = result.issues.find((i) => i.code === "SCORMTYPE_ASSET_SHOULD_BE_SCO");
    expect(issue?.fixApplied).toBe(true);
  });

  it("missing-launch-file: status failed, no output zip", () => {
    const data = buildFixtureZip("missing-launch-file", []);
    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("failed");
    expect(result.fixedZip).toBeNull();
  });

  it("nested-folders: status pass, nested paths preserved in the output zip", async () => {
    const data = buildFixtureZip("nested-folders", [
      "content/lesson1/index.html",
      "content/lesson1/style.css",
      "content/shared/common.js",
    ]);
    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("pass");
    const fixedBytes = await toUint8Array(result.fixedZip);
    const fixedFiles = safeUnzip(fixedBytes).files;
    expect(Object.keys(fixedFiles).sort()).toEqual(
      ["content/lesson1/index.html", "content/lesson1/style.css", "content/shared/common.js", "imsmanifest.xml"].sort()
    );
  });

  it("SCORM 2004 WITHOUT sequencing: converted to 1.2, status fixed", async () => {
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

    const data = buildZip({
      "imsmanifest.xml": strToU8(manifestXml),
      "index.html": strToU8("<html></html>"),
    });

    const result = fixPackage(data, namesOf(data));
    expect(result.status).toBe("fixed");
    expect(result.scormVersionIn).toBe("2004");
    expect(result.scormVersionOut).toBe("1.2");

    const fixedBytes = await toUint8Array(result.fixedZip);
    const fixedFiles = safeUnzip(fixedBytes).files;
    const rewritten = parseManifest(new TextDecoder().decode(fixedFiles["imsmanifest.xml"]));
    expect(rewritten.scormVersion).toBe("1.2");
  });
});
