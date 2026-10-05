import { describe, expect, it } from "vitest";
import { parseManifest, collectDirectlyReferencedIdentifiers } from "../../src/lib/scorm/manifest-parser";
import { FIXTURE_MANIFESTS } from "./helpers";

describe("parseManifest", () => {
  it("parses a valid SCORM 1.2 manifest", () => {
    const m = parseManifest(FIXTURE_MANIFESTS["valid-1.2"]);
    expect(m.scormVersion).toBe("1.2");
    expect(m.usesSequencing).toBe(false);
    expect(m.organizations).toHaveLength(1);
    expect(m.resources).toHaveLength(1);
    expect(m.resources[0]!.scormType).toBe("sco");
    expect(m.resources[0]!.href).toBe("index.html");
  });

  it("detects SCORM 2004 and sequencing usage", () => {
    const m = parseManifest(FIXTURE_MANIFESTS["scorm-2004"]);
    expect(m.scormVersion).toBe("2004");
    expect(m.usesSequencing).toBe(true);
  });

  it("detects scormtype=asset", () => {
    const m = parseManifest(FIXTURE_MANIFESTS["asset-scormtype"]);
    expect(m.resources[0]!.scormType).toBe("asset");
  });

  it("parses nested item trees and nested file paths", () => {
    const m = parseManifest(FIXTURE_MANIFESTS["nested-folders"]);
    const org = m.organizations[0]!;
    expect(org.items).toHaveLength(1);
    expect(org.items[0]!.identifier).toBe("MODULE-1");
    expect(org.items[0]!.identifierref).toBeUndefined();
    expect(org.items[0]!.children).toHaveLength(1);
    expect(org.items[0]!.children[0]!.identifierref).toBe("RES-1");
    expect(m.resources[0]!.files).toEqual([
      "content/lesson1/index.html",
      "content/lesson1/style.css",
      "content/shared/common.js",
    ]);
  });

  it("rejects malformed XML", () => {
    expect(() => parseManifest("<manifest><organizations>")).toThrow();
  });

  it("rejects a manifest missing <organizations>", () => {
    expect(() => parseManifest('<manifest identifier="x"><resources/></manifest>')).toThrow();
  });
});

describe("collectDirectlyReferencedIdentifiers", () => {
  it("only collects identifierrefs, including from nested items", () => {
    const m = parseManifest(FIXTURE_MANIFESTS["nested-folders"]);
    const ids = collectDirectlyReferencedIdentifiers(m.organizations);
    expect(ids.has("RES-1")).toBe(true);
    expect(ids.size).toBe(1);
  });
});
