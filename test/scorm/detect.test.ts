import { describe, expect, it } from "vitest";
import { strToU8, buildZip } from "../../src/lib/scorm/zip-utils";
import { detectFileType } from "../../src/lib/scorm/detect";
import { buildFixtureZip, corruptCompressedData } from "./helpers";

function fakeMp4(): Uint8Array {
  // box size (4 bytes, value irrelevant for sniffing) + ASCII "ftyp" + filler
  return new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
}

function fakeMov(): Uint8Array {
  // Same ftyp box shape as fakeMp4, but with the QuickTime major brand
  // ("qt  ", with trailing spaces) instead of "isom".
  return new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
}

function fakeWebm(): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
}

function fakeWav(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(strToU8("RIFF"), 0);
  // bytes 4-7: chunk size, irrelevant for sniffing
  bytes.set(strToU8("WAVE"), 8);
  return bytes;
}

function fakeMp3Id3(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00]);
}

function fakeMp3FrameSync(): Uint8Array {
  // 0xFF followed by a byte with its top 3 bits set (raw MPEG frame sync,
  // no ID3 tag).
  return new Uint8Array([0xff, 0xfb, 0x90, 0x44]);
}

function fakePng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

function fakeJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function fakeGif(): Uint8Array {
  return strToU8("GIF89a" + "filler bytes after the header");
}

function fakeSvg(): Uint8Array {
  return strToU8('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
}

// Legacy OLE2/CFBF container magic, followed by the UTF-16LE stream name
// detectLegacyOffice searches for, embedded as raw text further in (as it
// would really appear inside the compound file).
function fakeLegacyOffice(streamName: string): Uint8Array {
  const magic = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const padding = new Uint8Array(512);
  const utf16 = new Uint8Array(streamName.length * 2);
  for (let i = 0; i < streamName.length; i++) utf16[i * 2] = streamName.charCodeAt(i);
  const out = new Uint8Array(magic.length + padding.length + utf16.length);
  out.set(magic, 0);
  out.set(padding, magic.length);
  out.set(utf16, magic.length + padding.length);
  return out;
}

describe("detectFileType", () => {
  it("detects a PDF by magic bytes", () => {
    const bytes = strToU8("%PDF-1.4\n%the rest of a pdf...");
    expect(detectFileType(bytes).type).toBe("pdf");
  });

  it("detects an MP4 by the ftyp box", () => {
    expect(detectFileType(fakeMp4()).type).toBe("mp4");
  });

  it("detects a MOV by the ftyp box's QuickTime major brand", () => {
    expect(detectFileType(fakeMov()).type).toBe("mov");
  });

  it("detects a WebM by its EBML header", () => {
    expect(detectFileType(fakeWebm()).type).toBe("webm");
  });

  it("detects a WAV by its RIFF/WAVE header", () => {
    expect(detectFileType(fakeWav()).type).toBe("wav");
  });

  it("detects an MP3 with an ID3 tag", () => {
    expect(detectFileType(fakeMp3Id3()).type).toBe("mp3");
  });

  it("detects an MP3 with a raw MPEG frame sync and no ID3 tag", () => {
    expect(detectFileType(fakeMp3FrameSync()).type).toBe("mp3");
  });

  it("detects a PNG by magic bytes", () => {
    expect(detectFileType(fakePng()).type).toBe("png");
  });

  it("detects a JPEG by magic bytes", () => {
    expect(detectFileType(fakeJpeg()).type).toBe("jpg");
  });

  it("detects a GIF by its GIF89a header", () => {
    expect(detectFileType(fakeGif()).type).toBe("gif");
  });

  it("detects an SVG by content sniffing", () => {
    expect(detectFileType(fakeSvg()).type).toBe("svg");
  });

  it("detects a legacy .doc by its CFBF magic plus WordDocument stream name", () => {
    expect(detectFileType(fakeLegacyOffice("WordDocument")).type).toBe("doc");
  });

  it("detects a legacy .ppt by its CFBF magic plus PowerPoint Document stream name", () => {
    expect(detectFileType(fakeLegacyOffice("PowerPoint Document")).type).toBe("ppt");
  });

  it("returns unknown for a CFBF container with no recognized stream name (e.g. .xls)", () => {
    expect(detectFileType(fakeLegacyOffice("Workbook")).type).toBe("unknown");
  });

  it("detects a DOCX by its OOXML document structure", () => {
    const zip = buildZip({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8("<document/>"),
    });
    expect(detectFileType(zip).type).toBe("docx");
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
