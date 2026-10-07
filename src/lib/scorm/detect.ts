import type { Unzipped } from "fflate";
import { listZipEntries, safeUnzip, strFromU8 } from "./zip-utils";

export type DetectedFileType =
  | "scorm-zip"
  | "zip-of-zips"
  | "pptx"
  | "ppt"
  | "docx"
  | "doc"
  | "html-zip"
  | "pdf"
  | "mp4"
  | "webm"
  | "mov"
  | "mp3"
  | "wav"
  | "png"
  | "jpg"
  | "gif"
  | "svg"
  | "html"
  | "unknown";

export interface DetectionResult {
  type: DetectedFileType;
  // scorm-zip: the entry name list (classification + fixing never need
  // more than that -- see fixer.ts/validator.ts). html-zip: the fully
  // decompressed map, since wrapAsHtmlZip re-embeds every file's content
  // (that bundle is small web assets, not multi-MB video, so a full
  // decompress is cheap). zip-of-zips: the inner .zip entry names, to be
  // extracted (not decompressed) one at a time by the caller.
  names?: string[];
  files?: Unzipped;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]; // WebM/Matroska container header
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WAVE_MAGIC = [0x57, 0x41, 0x56, 0x45]; // "WAVE", at offset 8 of a RIFF file
const ID3_MAGIC = [0x49, 0x44, 0x33]; // "ID3" (MP3 ID3v2 tag)
const CFBF_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc/.ppt/.xls container

function matchesMagic(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

// ISO-BMFF: a box-size (4 bytes) followed by the ASCII box type "ftyp",
// then a 4-byte major brand. QuickTime .mov files use this same
// container with major brand "qt  "; every other brand we see in
// practice (isom, mp42, M4V, etc.) is MP4.
function isoBmffVariant(bytes: Uint8Array): "mp4" | "mov" | null {
  if (bytes.length < 12) return null;
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) return null;
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return brand === "qt  " ? "mov" : "mp4";
}

function isWav(bytes: Uint8Array): boolean {
  return matchesMagic(bytes, RIFF_MAGIC) && matchesMagic(bytes, WAVE_MAGIC, 8);
}

// MP3 has no single reliable magic byte: a file either starts with an
// ID3v2 tag (common for anything with metadata) or goes straight into a
// raw MPEG audio frame, whose 11-bit frame sync is 0xFF followed by a
// byte with its top 3 bits set. The frame-sync check is checked last,
// after every more specific format above has already failed, so a
// false-positive collision here is rare in practice.
function isMp3(bytes: Uint8Array): boolean {
  if (matchesMagic(bytes, ID3_MAGIC)) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

function isGif(bytes: Uint8Array): boolean {
  return matchesMagic(bytes, GIF87_MAGIC) || matchesMagic(bytes, GIF89_MAGIC);
}

function basename(path: string): string {
  return path.toLowerCase().split("/").pop() ?? "";
}

function hasImsManifest(names: string[]): boolean {
  return names.some((k) => basename(k) === "imsmanifest.xml");
}

function isPptxStructure(names: string[]): boolean {
  return names.some((k) => k.toLowerCase() === "ppt/presentation.xml");
}

function isDocxStructure(names: string[]): boolean {
  return names.some((k) => k.toLowerCase() === "word/document.xml");
}

function hasHtmlFile(names: string[]): boolean {
  return names.some((k) => k.toLowerCase().endsWith(".html") || k.toLowerCase().endsWith(".htm"));
}

// A "bulk" upload: a container ZIP whose own entries are themselves whole
// .zip files (each expected to be its own SCORM package), rather than a
// SCORM package itself. Only counts entries directly inside the
// container (no nested folders) -- an arbitrarily deep search isn't
// needed for how these get produced (an export tool or a user zipping up
// a folder of packages) and keeps expansion a flat, bounded operation.
function innerZipEntries(names: string[]): string[] {
  return names.filter((n) => n.toLowerCase().endsWith(".zip") && !n.includes("/"));
}

const CFBF_SCAN_LIMIT = 2 * 1024 * 1024; // the directory sector is always near the start

function utf16LePattern(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i);
  return out;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Legacy (pre-2007) binary Office formats all share the OLE2/CFBF
// container signature -- .doc, .ppt, and .xls are only distinguishable
// by which named stream the compound file's internal directory holds.
// A full CFBF directory walk just to tell them apart is a lot of
// machinery for a format most real-world uploads won't use (SEN
// exports are modern); this instead looks for each format's stream
// name as UTF-16LE text, which is how it's actually stored and
// reliably appears within the first couple MB for any real file.
// Spreadsheets are deliberately not matched -- SENtoArc doesn't
// support .xls, same as Learning Arc's own AI ingestion.
function detectLegacyOffice(bytes: Uint8Array): "doc" | "ppt" | "unknown" {
  const head = bytes.slice(0, CFBF_SCAN_LIMIT);
  if (includesBytes(head, utf16LePattern("WordDocument"))) return "doc";
  if (includesBytes(head, utf16LePattern("PowerPoint Document"))) return "ppt";
  return "unknown";
}

export function detectFileType(bytes: Uint8Array): DetectionResult {
  if (matchesMagic(bytes, PDF_MAGIC)) {
    return { type: "pdf" };
  }

  const isoBmff = isoBmffVariant(bytes);
  if (isoBmff) {
    return { type: isoBmff };
  }

  if (matchesMagic(bytes, EBML_MAGIC)) {
    return { type: "webm" };
  }

  if (isWav(bytes)) {
    return { type: "wav" };
  }

  if (matchesMagic(bytes, PNG_MAGIC)) {
    return { type: "png" };
  }

  if (matchesMagic(bytes, JPEG_MAGIC)) {
    return { type: "jpg" };
  }

  if (isGif(bytes)) {
    return { type: "gif" };
  }

  if (matchesMagic(bytes, ZIP_MAGIC)) {
    let names: string[];
    try {
      names = listZipEntries(bytes).entries.map((e) => e.name);
    } catch {
      return { type: "unknown" };
    }
    if (hasImsManifest(names)) return { type: "scorm-zip", names };
    if (isPptxStructure(names)) return { type: "pptx" };
    if (isDocxStructure(names)) return { type: "docx" };

    const innerZips = innerZipEntries(names);
    if (innerZips.length >= 2) return { type: "zip-of-zips", names: innerZips };

    if (hasHtmlFile(names)) {
      // Unlike listZipEntries above, this actually inflates every entry
      // -- a zip whose headers parsed fine (that's how we got here) can
      // still have corrupted/truncated compressed data that only fails
      // once something really tries to decompress it, same as the catch
      // above but for the real inflate instead of the header scan.
      try {
        // html-zip bundles are small web assets (html/css/js/images), not
        // multi-MB video -- a full decompress here is cheap, and
        // wrapAsHtmlZip needs every file's actual content to re-embed it.
        return { type: "html-zip", files: safeUnzip(bytes).files };
      } catch {
        return { type: "unknown" };
      }
    }
    return { type: "unknown" };
  }

  if (matchesMagic(bytes, CFBF_MAGIC)) {
    const legacy = detectLegacyOffice(bytes);
    return { type: legacy };
  }

  if (isMp3(bytes)) {
    return { type: "mp3" };
  }

  // Not a recognized binary signature — sniff for plain HTML or SVG text
  // content.
  const head = strFromU8(bytes.slice(0, 512)).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) {
    return { type: "html" };
  }
  if (head.includes("<svg")) {
    return { type: "svg" };
  }

  return { type: "unknown" };
}
