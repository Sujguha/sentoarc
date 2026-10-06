import { describe, expect, it } from "vitest";
import { csvField, csvRow } from "../src/routes/jobs";

describe("csvField", () => {
  it("passes plain values through unquoted", () => {
    expect(csvField("hello")).toBe("hello");
    expect(csvField(42)).toBe("42");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and escapes a value containing a comma", () => {
    expect(csvField("course, final")).toBe('"course, final"');
  });

  it("quotes and doubles embedded double-quotes", () => {
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("csvRow", () => {
  it("joins fields with commas and ends with CRLF", () => {
    expect(csvRow(["a", "b", 3])).toBe("a,b,3\r\n");
  });

  it("correctly escapes a mixed row", () => {
    const row = csvRow(["course-a.zip", "fixed", null, '[error] BAD, "quoted"']);
    expect(row).toBe('course-a.zip,fixed,,"[error] BAD, ""quoted"""\r\n');
  });
});
