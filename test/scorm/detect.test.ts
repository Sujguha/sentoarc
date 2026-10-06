import { describe, expect, it } from "vitest";
import { strToU8, buildZip } from "../../src/lib/scorm/zip-utils";
import { detectFileType } from "../../src/lib/scorm/detect";
import { buildFixtureZip, corruptCompressedData } from "./helpers";

function fakeMp4(): Uint8Array {
  // box size (4 bytes, value irrelevant for sniffing) + ASCII "ftyp" + filler
  return new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
}

describe("detectFileType", () => {
  it("detects a PDF by magic bytes", () => {
    const bytes = strToU8("%PDF-1.4\n%the rest of a pdf...");
    expect(detectFileType(bytes).type).toBe("pdf");
  });

  it("detects an MP4 by the ftyp box", () => {
    expect(detectFileType(fakeMp4()).type).toBe("mp4");
  });

  it("detects a SCORM ZIP (imsmanifest.xml present) and returns the entry name list", () => {
    const result = detectFileType(buildFixtureZip("valid-1.2", ["index.html"]));
    expect(result.type).toBe("scorm-zip");
    expect(result.names).toBeDefined();
    expect(result.names).toContain("imsmanifest.xml");
  });

  it("detects a PPTX by its OOXML presentation structure", () => {
    const zip = buildZip({
      "[Content_Types].xml": strToU8("<Types/>"),
      "ppt/presentation.xml": strToU8("<presentation/>"),
    });
    expect(detectFileType(zip).type).toBe("pptx");
  });

  it("detects a ZIP of plain web content as html-zip", () => {
    const zip = buildZip({
      "index.html": strToU8("<!doctype html><html><body>hi</body></html>"),
      "style.css": strToU8("body{color:red}"),
    });
    const result = detectFileType(zip);
    expect(result.type).toBe("html-zip");
    expect(result.files).toBeDefined();
  });

  it("detects a single HTML file by content sniffing", () => {
    const bytes = strToU8("<!doctype html>\n<html><head></head><body>hi</body></html>");
    expect(detectFileType(bytes).type).toBe("html");
  });

  it("returns unknown for unrecognized content", () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(detectFileType(bytes).type).toBe("unknown");
  });

  it("returns unknown for an empty ZIP", () => {
    expect(detectFileType(buildZip({})).type).toBe("unknown");
  });

  // Regression test: a zip whose central directory parses fine (so it's
  // classified as html-zip by name alone) but whose actual compressed
  // data is corrupted only fails once something really tries to inflate
  // it -- that real decompress happens right here in the html-zip
  // branch, not earlier during classification. Before this fix that
  // throw wasn't caught, so a corrupted upload crashed the caller
  // instead of being reported as "unknown"/unreadable.
  it("returns unknown (not a throw) for a ZIP with corrupted compressed data", () => {
    const corrupted = corruptCompressedData(
      buildZip({
        "index.html": strToU8("<!doctype html><html><body>hi</body></html>"),
        "style.css": strToU8("body{color:red}"),
      })
    );
    expect(() => detectFileType(corrupted)).not.toThrow();
    expect(detectFileType(corrupted).type).toBe("unknown");
  });

  it("detects a container of multiple inner .zip packages as zip-of-zips", () => {
    const inner1 = buildFixtureZip("valid-1.2", ["index.html"]);
    const inner2 = buildFixtureZip("scorm-2004", ["index.html"]);
    const container = buildZip({
      "course-a.zip": [inner1, { level: 0 }],
      "course-b.zip": [inner2, { level: 0 }],
    });
    const result = detectFileType(container);
    expect(result.type).toBe("zip-of-zips");
    expect(result.names).toEqual(expect.arrayContaining(["course-a.zip", "course-b.zip"]));
  });

  it("does not classify a ZIP with a single nested .zip as zip-of-zips", () => {
    const inner = buildFixtureZip("valid-1.2", ["index.html"]);
    // Only one inner .zip, alongside an unrelated file -- a single
    // incidental .zip entry shouldn't trigger bulk expansion.
    const container = buildZip({
      "course-a.zip": [inner, { level: 0 }],
      "readme.txt": strToU8("just one package here"),
    });
    expect(detectFileType(container).type).toBe("unknown");
  });

  it("ignores nested .zip entries inside subfolders when counting for zip-of-zips", () => {
    const inner = buildFixtureZip("valid-1.2", ["index.html"]);
    const container = buildZip({
      "folder/course-a.zip": [inner, { level: 0 }],
      "folder/course-b.zip": [inner, { level: 0 }],
    });
    // Both inner zips are nested one level deep -- not top-level entries,
    // so this isn't classified as a flat zip-of-zips bundle.
    expect(detectFileType(container).type).toBe("unknown");
  });
});
