import { describe, expect, it } from "vitest";
import { ALLOWED_EXTENSIONS, extensionOf } from "../src/routes/uploads";

describe("extensionOf", () => {
  for (const ext of ALLOWED_EXTENSIONS) {
    it(`accepts a filename ending in ${ext}`, () => {
      expect(extensionOf(`course${ext}`)).toBe(ext);
    });
  }

  it("is case-insensitive", () => {
    expect(extensionOf("Course.ZIP")).toBe(".zip");
    expect(extensionOf("Video.MP4")).toBe(".mp4");
  });

  // The actual rejection a user hits when uploading a wrong file type --
  // this is the filename-extension allowlist in uploads.ts, a shallow
  // first gate. detectFileType (tested separately in detect.test.ts and
  // end-to-end in queue-consumer.test.ts) is what actually sniffs file
  // content; this allowlist exists only to reject obviously-wrong
  // uploads before they're even accepted for storage.
  it("rejects an executable", () => {
    expect(extensionOf("totally-safe-course.exe")).toBeNull();
  });

  it("rejects a plain text file", () => {
    expect(extensionOf("readme.txt")).toBeNull();
  });

  it("rejects a filename with no extension at all", () => {
    expect(extensionOf("course")).toBeNull();
  });

  it("rejects an extension that merely contains an allowed one as a substring", () => {
    // ".zipper" must not match ".zip" -- extensionOf checks a true
    // suffix (endsWith), not "contains", so this would only pass if
    // that check were loosened to a naive substring match.
    expect(extensionOf("course.zipper")).toBeNull();
  });

  it("is not fooled by an allowed extension appearing earlier in the name", () => {
    // Only the name's actual (last) extension should ever match --
    // "course.zip.exe" is an executable with a deceptive filename, a
    // real-world disguise technique, not a zip.
    expect(extensionOf("course.zip.exe")).toBeNull();
  });

  it("rejects an empty filename", () => {
    expect(extensionOf("")).toBeNull();
  });
});
