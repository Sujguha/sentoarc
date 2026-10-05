import { unzipSync, zipSync, strFromU8, strToU8, type Unzipped, type Zippable } from "fflate";

export const ZIP_LIMITS = {
  maxEntryCount: 20_000,
  maxTotalUncompressedBytes: 500 * 1024 * 1024,
  maxSingleFileUncompressedBytes: 200 * 1024 * 1024,
};

export class ZipSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSecurityError";
  }
}

// Rejects absolute paths, parent-directory traversal, and Windows drive
// letters — the classic "zip slip" vectors for writing outside the
// intended extraction root.
export function isSafeEntryPath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.split(/[/\\]/).includes("..")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  return true;
}

export interface SafeUnzipResult {
  files: Unzipped;
  totalUncompressedBytes: number;
  entryCount: number;
}

// Reads each entry's declared uncompressed size from the central
// directory via fflate's filter callback — called BEFORE that entry is
// inflated — so a zip bomb (tiny compressed size, huge declared
// uncompressed size) is rejected without ever decompressing it.
export function safeUnzip(data: Uint8Array, limits = ZIP_LIMITS): SafeUnzipResult {
  let totalUncompressedBytes = 0;
  let entryCount = 0;

  const files = unzipSync(data, {
    filter(file) {
      if (file.name.endsWith("/")) return false; // directory entries carry no content

      if (!isSafeEntryPath(file.name)) {
        throw new ZipSecurityError(`Unsafe entry path: ${file.name}`);
      }

      entryCount++;
      if (entryCount > limits.maxEntryCount) {
        throw new ZipSecurityError(`Too many entries in ZIP (max ${limits.maxEntryCount})`);
      }

      if (file.originalSize > limits.maxSingleFileUncompressedBytes) {
        throw new ZipSecurityError(
          `Entry "${file.name}" exceeds max single-file size (${limits.maxSingleFileUncompressedBytes} bytes)`
        );
      }

      totalUncompressedBytes += file.originalSize;
      if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
        throw new ZipSecurityError(
          `Total uncompressed size exceeds limit (${limits.maxTotalUncompressedBytes} bytes)`
        );
      }

      return true;
    },
  });

  return { files, totalUncompressedBytes, entryCount };
}

export function readEntryText(files: Unzipped, path: string): string | null {
  const bytes = files[path];
  return bytes ? strFromU8(bytes) : null;
}

// Case-insensitive lookup for entries whose casing doesn't match a
// manifest reference exactly — common when SEN exports from a
// case-insensitive filesystem.
export function findEntryCaseInsensitive(files: Unzipped, path: string): string | null {
  if (files[path]) return path;
  const lower = path.toLowerCase();
  for (const key of Object.keys(files)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

export function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files as Zippable, { level: 6 });
}

export { strToU8, strFromU8 };
