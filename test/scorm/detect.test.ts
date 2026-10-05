import { describe, expect, it } from "vitest";
import { strToU8, buildZip } from "../../src/lib/scorm/zip-utils";
import { detectFileType } from "../../src/lib/scorm/detect";
import { buildFixtureZip } from "./helpers";

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

  it("detects a SCORM ZIP (imsmanifest.xml present) and returns the unzipped files", () => {
    const result = detectFileType(buildFixtureZip("valid-1.2", ["index.html"]));
    expect(result.type).toBe("scorm-zip");
    expect(result.files).toBeDefined();
    expect(Object.keys(result.files!)).toContain("imsmanifest.xml");
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
});
