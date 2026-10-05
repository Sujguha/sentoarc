import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { buildZip, isSafeEntryPath, safeUnzip, findEntryCaseInsensitive, ZipSecurityError } from "../../src/lib/scorm/zip-utils";

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
