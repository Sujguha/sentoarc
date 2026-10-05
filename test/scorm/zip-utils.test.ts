import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import {
  buildZip,
  isSafeEntryPath,
  safeUnzip,
  findEntryCaseInsensitive,
  findNameCaseInsensitive,
  listZipEntries,
  decompressSingleEntry,
  buildFixedZipStream,
  ZipSecurityError,
} from "../../src/lib/scorm/zip-utils";

async function toUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
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

describe("isSafeEntryPath", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeEntryPath("imsmanifest.xml")).toBe(true);
    expect(isSafeEntryPath("content/lesson1/index.html")).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(isSafeEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeEntryPath("\\windows\\system32")).toBe(false);
  });

  it("rejects parent-directory traversal", () => {
    expect(isSafeEntryPath("../../etc/passwd")).toBe(false);
    expect(isSafeEntryPath("content/../../escape.txt")).toBe(false);
  });

  it("rejects Windows drive letters", () => {
    expect(isSafeEntryPath("C:\\evil.exe")).toBe(false);
  });
});

describe("safeUnzip", () => {
  it("unzips a well-formed archive", () => {
    const zip = buildZip({ "a.txt": strToU8("hello"), "b.txt": strToU8("world") });
    const result = safeUnzip(zip);
    expect(result.entryCount).toBe(2);
    expect(Object.keys(result.files).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("enforces the entry count limit", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.txt`] = strToU8("x");
    const zip = buildZip(files);
    expect(() => safeUnzip(zip, { maxEntryCount: 3, maxTotalUncompressedBytes: 1_000_000, maxSingleFileUncompressedBytes: 1_000_000 })).toThrow(
      ZipSecurityError
    );
  });

  it("enforces the total uncompressed size limit", () => {
    const zip = buildZip({ "big.txt": strToU8("x".repeat(1000)) });
    expect(() =>
      safeUnzip(zip, { maxEntryCount: 100, maxTotalUncompressedBytes: 500, maxSingleFileUncompressedBytes: 500 })
    ).toThrow(ZipSecurityError);
  });
});

describe("findEntryCaseInsensitive", () => {
  it("finds an exact match first", () => {
    const zip = safeUnzip(buildZip({ "Index.html": strToU8("x") }));
    expect(findEntryCaseInsensitive(zip.files, "Index.html")).toBe("Index.html");
  });

  it("falls back to a case-insensitive match", () => {
    const zip = safeUnzip(buildZip({ "Index.html": strToU8("x") }));
    expect(findEntryCaseInsensitive(zip.files, "index.html")).toBe("Index.html");
  });

  it("returns null when nothing matches", () => {
    const zip = safeUnzip(buildZip({ "Index.html": strToU8("x") }));
    expect(findEntryCaseInsensitive(zip.files, "missing.html")).toBeNull();
  });
});

describe("listZipEntries", () => {
  it("lists entry names and sizes without decompressing anything", () => {
    const zip = buildZip({ "a.txt": strToU8("hello"), "b.txt": strToU8("world!") });
    const result = listZipEntries(zip);
    expect(result.entries.map((e) => e.name).sort()).toEqual(["a.txt", "b.txt"]);
    expect(result.totalUncompressedBytes).toBe(5 + 6);
  });

  it("enforces the same security/size limits as safeUnzip", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) files[`f${i}.txt`] = strToU8("x");
    const zip = buildZip(files);
    expect(() =>
      listZipEntries(zip, { maxEntryCount: 3, maxTotalUncompressedBytes: 1_000_000, maxSingleFileUncompressedBytes: 1_000_000 })
    ).toThrow(ZipSecurityError);
  });
});

describe("findNameCaseInsensitive", () => {
  it("finds an exact match first", () => {
    expect(findNameCaseInsensitive(["Index.html"], "Index.html")).toBe("Index.html");
  });

  it("falls back to a case-insensitive match", () => {
    expect(findNameCaseInsensitive(["Index.html"], "index.html")).toBe("Index.html");
  });

  it("returns null when nothing matches", () => {
    expect(findNameCaseInsensitive(["Index.html"], "missing.html")).toBeNull();
  });
});

describe("decompressSingleEntry", () => {
  it("decompresses only the requested entry", () => {
    const zip = buildZip({ "a.txt": strToU8("hello"), "b.txt": strToU8("world") });
    expect(decompressSingleEntry(zip, "a.txt")).toEqual(strToU8("hello"));
  });

  it("returns null for a missing entry", () => {
    const zip = buildZip({ "a.txt": strToU8("hello") });
    expect(decompressSingleEntry(zip, "missing.txt")).toBeNull();
  });
});

describe("buildFixedZipStream", () => {
  it("passes unchanged entries through byte-identical and replaces the named entry", async () => {
    const zip = buildZip({
      "imsmanifest.xml": strToU8("<old/>"),
      "content/index.html": strToU8("<html>hi</html>"),
      "content/payload.bin": strToU8("x".repeat(5000)), // bigger than one internal chunk's worth
    });

    const outStream = buildFixedZipStream(zip, { "imsmanifest.xml": strToU8("<new/>") });
    const outBytes = await toUint8Array(outStream);
    const outFiles = safeUnzip(outBytes).files;

    expect(new TextDecoder().decode(outFiles["imsmanifest.xml"])).toBe("<new/>");
    expect(new TextDecoder().decode(outFiles["content/index.html"])).toBe("<html>hi</html>");
    expect(outFiles["content/payload.bin"]).toEqual(strToU8("x".repeat(5000)));
  });

  it("round-trips a passthrough entry spanning multiple internal chunks unchanged", async () => {
    // Just over one CHUNK_SIZE (256KB) so the pull() loop runs multiple
    // times -- random/incompressible like real media, and filled natively
    // rather than via a slow per-byte JS loop (the test sandbox here has
    // a shared CPU/time budget across a whole suite run, and a few
    // hundred KB is plenty to exercise the multi-chunk path).
    const big = new Uint8Array(320 * 1024);
    for (let i = 0; i < big.length; i += 65536) {
      crypto.getRandomValues(big.subarray(i, Math.min(i + 65536, big.length)));
    }

    const zip = buildZip({
      "imsmanifest.xml": strToU8("<old/>"),
      "payload.bin": big,
    });

    const outStream = buildFixedZipStream(zip, { "imsmanifest.xml": strToU8("<new/>") });
    const outFiles = safeUnzip(await toUint8Array(outStream)).files;

    expect(outFiles["payload.bin"]).toEqual(big);
  });

  it("rejects an unsafe entry path", async () => {
    // Build a zip with an unsafe name by bypassing isSafeEntryPath (zipSync itself
    // doesn't validate names), then confirm the stream errors out rather than
    // silently writing outside the intended root.
    const zip = buildZip({ "../escape.txt": strToU8("x") } as unknown as Record<string, Uint8Array>);
    const outStream = buildFixedZipStream(zip, {});
    await expect(toUint8Array(outStream)).rejects.toThrow(ZipSecurityError);
  });
});
