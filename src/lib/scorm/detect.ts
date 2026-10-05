import type { Unzipped } from "fflate";
import { safeUnzip, strFromU8 } from "./zip-utils";

export type DetectedFileType = "scorm-zip" | "pptx" | "html-zip" | "pdf" | "mp4" | "html" | "unknown";

export interface DetectionResult {
  type: DetectedFileType;
  // Populated for zip-based types so callers don't have to unzip again.
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

function hasImsManifest(files: Unzipped): boolean {
  return Object.keys(files).some((k) => basename(k) === "imsmanifest.xml");
}

function isPptxStructure(files: Unzipped): boolean {
  return Object.keys(files).some((k) => k.toLowerCase() === "ppt/presentation.xml");
}

function hasHtmlFile(files: Unzipped): boolean {
  return Object.keys(files).some((k) => k.toLowerCase().endsWith(".html") || k.toLowerCase().endsWith(".htm"));
}

export function detectFileType(bytes: Uint8Array): DetectionResult {
  if (matchesMagic(bytes, PDF_MAGIC)) {
    return { type: "pdf" };
  }

  if (isMp4(bytes)) {
    return { type: "mp4" };
  }

  if (matchesMagic(bytes, ZIP_MAGIC)) {
    let files: Unzipped;
    try {
      files = safeUnzip(bytes).files;
    } catch {
      return { type: "unknown" };
    }
    if (hasImsManifest(files)) return { type: "scorm-zip", files };
    if (isPptxStructure(files)) return { type: "pptx", files };
    if (hasHtmlFile(files)) return { type: "html-zip", files };
    return { type: "unknown" };
  }

  // Not a recognized binary signature — sniff for plain HTML text content.
  const head = strFromU8(bytes.slice(0, 512)).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) {
    return { type: "html" };
  }

  return { type: "unknown" };
}
