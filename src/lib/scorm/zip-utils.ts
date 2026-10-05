import {
  unzipSync,
  zipSync,
  strFromU8,
  strToU8,
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  type Unzipped,
  type Zippable,
} from "fflate";

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

export interface ZipEntryInfo {
  name: string;
  originalSize: number;
}

export interface ListZipEntriesResult {
  entries: ZipEntryInfo[];
  totalUncompressedBytes: number;
}

// Same security/size enforcement as safeUnzip, but the filter never
// returns true -- fflate's central-directory scan still runs (so every
// entry's declared name/size is visible here), but nothing is ever
// inflated. This is the listing used by detection and validation, which
// only ever need names + one small entry's text, never the full
// decompressed package.
export function listZipEntries(data: Uint8Array, limits = ZIP_LIMITS): ListZipEntriesResult {
  const entries: ZipEntryInfo[] = [];
  let totalUncompressedBytes = 0;

  unzipSync(data, {
    filter(file) {
      if (file.name.endsWith("/")) return false;

      if (!isSafeEntryPath(file.name)) {
        throw new ZipSecurityError(`Unsafe entry path: ${file.name}`);
      }

      entries.push({ name: file.name, originalSize: file.originalSize });
      if (entries.length > limits.maxEntryCount) {
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

      return false;
    },
  });

  return { entries, totalUncompressedBytes };
}

// Decompresses exactly one entry (by exact name), leaving every other
// entry's central-directory-declared size visible to the same filter
// but never inflated. Used to read just imsmanifest.xml out of a
// package that may otherwise be tens or hundreds of MB.
export function decompressSingleEntry(data: Uint8Array, path: string): Uint8Array | null {
  const files = unzipSync(data, { filter: (file) => file.name === path });
  return files[path] ?? null;
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

// Same lookup, operating on a plain name list instead of a decompressed
// map -- for callers (validator.ts) that only ever need to know whether
// a name exists, not its content.
export function findNameCaseInsensitive(names: string[], path: string): string | null {
  if (names.includes(path)) return path;
  const lower = path.toLowerCase();
  for (const name of names) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

export function buildZip(files: Zippable): Uint8Array {
  return zipSync(files, { level: 6 });
}

// Rebuilds a ZIP, replacing the content of entries named in `replacements`
// (freshly deflated) while every other entry is piped through from the
// original compressed bytes to the output unchanged -- inflated once
// (fflate's streaming decoder gives us no way to avoid that with its
// public API) but never held whole in memory and never recompressed.
// This is what makes fixing a package cheap regardless of how large its
// *other*, unchanged files are: the manifest is the only thing fixPackage
// ever actually rewrites.
// fflate's inflate hands back however much a single push() decompresses
// to in one callback -- for a well-compressed entry that can be its
// *entire* decompressed content in one shot, regardless of how small the
// compressed input chunk was. Re-slicing on the way out keeps any single
// enqueued/pushed chunk bounded, which is what actually keeps this
// bounded in memory (chunking only the compressed input isn't enough).
function pushInChunks(sink: { push(chunk: Uint8Array, final: boolean): void }, data: Uint8Array, final: boolean, maxChunk: number) {
  if (data.length === 0) {
    sink.push(data, final);
    return;
  }
  for (let i = 0; i < data.length; i += maxChunk) {
    const slice = data.subarray(i, Math.min(i + maxChunk, data.length));
    sink.push(slice, final && i + maxChunk >= data.length);
  }
}

export function buildFixedZipStream(
  originalData: Uint8Array,
  replacements: Record<string, Uint8Array>
): ReadableStream<Uint8Array> {
  const CHUNK_SIZE = 256 * 1024;
  let offset = 0;
  let finished = false;
  let pendingError: unknown = null;
  let reader: Unzip;
  let outZip: Zip;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      outZip = new Zip((err, chunk, final) => {
        if (err) {
          pendingError = err;
          return;
        }
        if (chunk && chunk.length > 0) {
          for (let i = 0; i < chunk.length; i += CHUNK_SIZE) {
            controller.enqueue(chunk.subarray(i, Math.min(i + CHUNK_SIZE, chunk.length)));
          }
        }
        if (final) finished = true;
      });

      reader = new Unzip((file) => {
        if (file.name.endsWith("/")) return; // directory entry, no data

        if (!isSafeEntryPath(file.name)) {
          pendingError = new ZipSecurityError(`Unsafe entry path: ${file.name}`);
          return;
        }

        const replacement = replacements[file.name];
        if (replacement !== undefined) {
          // Content changes: write the pre-fixed bytes, ignore the
          // original entry's data entirely (never call start() on it).
          const out = new ZipDeflate(file.name);
          outZip.add(out);
          out.push(replacement, true);
          return;
        }

        const out = new ZipPassThrough(file.name);
        outZip.add(out);
        file.ondata = (err2, chunk2, final2) => {
          if (err2) {
            pendingError = err2;
            return;
          }
          pushInChunks(out, chunk2, final2, CHUNK_SIZE);
        };
        file.start();
      });
      reader.register(UnzipInflate);
      reader.register(UnzipPassThrough);
    },
    pull(controller) {
      if (pendingError) {
        controller.error(pendingError);
        return;
      }
      if (finished) {
        controller.close();
        return;
      }

      const end = Math.min(offset + CHUNK_SIZE, originalData.length);
      const isLast = end >= originalData.length;
      const slice = originalData.subarray(offset, end);
      offset = end;

      reader.push(slice, isLast);
      if (isLast) outZip.end();

      if (pendingError) {
        controller.error(pendingError);
        return;
      }
      if (finished) controller.close();
      // Otherwise: this pull() produced no terminal state yet. The stream
      // will call pull() again on its own as long as desiredSize > 0.
    },
  });
}

export { strToU8, strFromU8 };
