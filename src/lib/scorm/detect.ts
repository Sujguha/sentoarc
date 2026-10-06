import type { Unzipped } from "fflate";
import { listZipEntries, safeUnzip, strFromU8 } from "./zip-utils";

export type DetectedFileType = "scorm-zip" | "zip-of-zips" | "pptx" | "html-zip" | "pdf" | "mp4" | "html" | "unknown";

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

function matchesMagic(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

// MP4/ISO-BMFF: a box-size (4 bytes) followed by the ASCII box type "ftyp".
function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
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

export function detectFileType(bytes: Uint8Array): DetectionResult {
  if (matchesMagic(bytes, PDF_MAGIC)) {
    return { type: "pdf" };
  }

  if (isMp4(bytes)) {
    return { type: "mp4" };
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

  // Not a recognized binary signature — sniff for plain HTML text content.
  const head = strFromU8(bytes.slice(0, 512)).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) {
    return { type: "html" };
  }

  return { type: "unknown" };
}
