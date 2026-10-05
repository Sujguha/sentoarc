import { describe, expect, it } from "vitest";
import type { Zippable } from "fflate";
import { strToU8, buildZip, listZipEntries, safeUnzip } from "../../src/lib/scorm/zip-utils";
import { validatePackage, hasErrors } from "../../src/lib/scorm/validator";
import {
  wrapAsPdf,
  wrapAsVideo,
  wrapAsPptx,
  wrapAsHtml,
  wrapAsHtmlZip,
  titleFromFilename,
} from "../../src/lib/scorm/wrapper";

// Every wrapper's output must itself be a clean, valid SCORM package —
// checked by running it back through our own validator (dogfooding),
// the same bar real SEN exports are held to.
function expectCleanScormPackage(files: Zippable) {
  const zip = buildZip(files);
  const names = listZipEntries(zip).entries.map((e) => e.name);
  const result = validatePackage(zip, names);
  expect(hasErrors(result.issues)).toBe(false);
  expect(result.manifest?.scormVersion).toBe("1.2");
  return result;
}

// Large/already-compressed entries (content.pdf, content.mp4, content.pptx)
// are tagged [bytes, {level: 0}] (STORE) rather than a plain Uint8Array --
// see wrapper.ts's `stored()`.
function storedBytes(entry: Uint8Array | [Uint8Array, unknown]): Uint8Array {
  return Array.isArray(entry) ? entry[0] : entry;
}

describe("titleFromFilename", () => {
  it("strips the extension and humanizes separators", () => {
    expect(titleFromFilename("My-File_Name.pdf")).toBe("My File Name");
    expect(titleFromFilename("report.v2.final.pdf")).toBe("report.v2.final");
  });

  it("falls back to Untitled for an empty name", () => {
    expect(titleFromFilename(".pdf")).toBe("Untitled");
  });
});

describe("wrapAsPdf", () => {
  it("produces a clean SCORM package embedding the PDF", () => {
    const pdfBytes = strToU8("%PDF-1.4 fake pdf content");
    const result = wrapAsPdf("Onboarding Guide", pdfBytes);
    expect(storedBytes(result.files["content.pdf"] as Uint8Array | [Uint8Array, unknown])).toBe(pdfBytes);
    expectCleanScormPackage(result.files);
  });
});

describe("wrapAsVideo", () => {
  it("produces a clean SCORM package with an auto-complete-on-ended video", () => {
    const videoBytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const result = wrapAsVideo("Walkthrough", videoBytes);
    expect(storedBytes(result.files["content.mp4"] as Uint8Array | [Uint8Array, unknown])).toBe(videoBytes);
    const launchHtml = new TextDecoder().decode(result.files["launch.html"] as Uint8Array);
    expect(launchHtml).toContain("addEventListener(\"ended\"");
    expectCleanScormPackage(result.files);
  });
});

describe("wrapAsPptx", () => {
  it("produces a clean SCORM package with a download link (no slide rendering)", () => {
    const pptxBytes = strToU8("fake pptx bytes");
    const result = wrapAsPptx("Slide Deck", pptxBytes);
    expect(storedBytes(result.files["content.pptx"] as Uint8Array | [Uint8Array, unknown])).toBe(pptxBytes);
    const launchHtml = new TextDecoder().decode(result.files["launch.html"] as Uint8Array);
    expect(launchHtml).toContain("Download the presentation");
    expectCleanScormPackage(result.files);
  });
});

describe("wrapAsHtml", () => {
  it("produces a clean SCORM package embedding a single HTML file", () => {
    const htmlBytes = strToU8("<!doctype html><html><body>hi</body></html>");
    const result = wrapAsHtml("A Page", htmlBytes);
    expect(result.files["content/index.html"]).toBe(htmlBytes);
    expectCleanScormPackage(result.files);
  });
});

describe("wrapAsHtmlZip", () => {
  it("preserves the original structure under content/ and finds index.html", () => {
    const zipFiles = safeUnzip(
      buildZip({
        "index.html": strToU8("<!doctype html><html><body>hi</body></html>"),
        "style.css": strToU8("body{color:red}"),
        "assets/logo.png": strToU8("not a real png, just bytes"),
      })
    ).files;

    const result = wrapAsHtmlZip("Mini Site", zipFiles);
    expect(Object.keys(result.files)).toEqual(
      expect.arrayContaining(["content/index.html", "content/style.css", "content/assets/logo.png"])
    );
    expectCleanScormPackage(result.files);
  });

  it("falls back to the first HTML file found when there's no index.html", () => {
    const zipFiles = safeUnzip(
      buildZip({ "lesson.html": strToU8("<!doctype html><html><body>hi</body></html>") })
    ).files;

    const result = wrapAsHtmlZip("Lesson", zipFiles);
    const manifestXml = new TextDecoder().decode(result.files["imsmanifest.xml"] as Uint8Array);
    expect(manifestXml).toContain("content/lesson.html");
    expectCleanScormPackage(result.files);
  });

  it("throws when the ZIP has no HTML file at all", () => {
    const zipFiles = safeUnzip(buildZip({ "data.json": strToU8("{}") })).files;
    expect(() => wrapAsHtmlZip("No HTML", zipFiles)).toThrow();
  });
});
