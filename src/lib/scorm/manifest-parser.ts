import { XMLParser, XMLBuilder } from "fast-xml-parser";

export type ScormVersion = "1.2" | "2004" | "unknown";

export interface ManifestResource {
  identifier: string;
  type?: string;
  scormType?: string;
  href?: string;
  files: string[];
}

export interface ManifestItem {
  identifier: string;
  identifierref?: string;
  title?: string;
  children: ManifestItem[];
}

export interface ManifestOrganization {
  identifier: string;
  title?: string;
  items: ManifestItem[];
}

export interface ParsedManifest {
  identifier: string | null;
  schemaVersionRaw: string | null;
  scormVersion: ScormVersion;
  defaultOrganizationId: string | null;
  organizations: ManifestOrganization[];
  resources: ManifestResource[];
  usesSequencing: boolean;
  raw: unknown;
}

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestParseError";
  }
}

// fast-xml-parser never resolves DTDs/external entities — there is no
// XXE surface here by construction, unlike a full DOM/libxml parser.
const REPEATABLE_TAGS = new Set(["item", "resource", "file", "organization"]);

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  parseTagValue: false, // keep text content (e.g. schemaversion "1.2") as strings, never coerced to number
  ignoreDeclaration: true, // the <?xml ...?> PI is re-added by serializeManifest, never kept in `raw`
  trimValues: true,
  isArray: (tagName: string) => REPEATABLE_TAGS.has(tagName),
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function detectScormVersion(schemaVersionRaw: string | null, xml: string): ScormVersion {
  const normalized = (schemaVersionRaw ?? "").toLowerCase();
  if (normalized.includes("2004")) return "2004";
  if (normalized.includes("1.2")) return "1.2";
  if (/rootv1p2/i.test(xml)) return "1.2";
  if (/_v1p3|cam_1p3/i.test(xml)) return "2004";
  return "unknown";
}

function parseItems(rawItems: unknown): ManifestItem[] {
  return asArray<any>(rawItems).map((item) => ({
    identifier: item["@_identifier"] ?? "",
    identifierref: item["@_identifierref"],
    title: typeof item.title === "string" ? item.title : item.title?.["#text"],
    children: parseItems(item.item),
  }));
}

export function parseManifest(xml: string): ParsedManifest {
  let raw: any;
  try {
    raw = new XMLParser(PARSER_OPTIONS).parse(xml, true);
  } catch (err) {
    throw new ManifestParseError(`imsmanifest.xml is not well-formed XML: ${(err as Error).message}`);
  }

  const manifest = raw?.manifest;
  if (!manifest) {
    throw new ManifestParseError("Missing root <manifest> element");
  }

  const schemaVersionRaw: string | null = manifest.metadata?.schemaversion ?? null;

  const organizationsNode = manifest.organizations;
  if (!organizationsNode) {
    throw new ManifestParseError("Missing required <organizations> element");
  }
  const defaultOrganizationId: string | null = organizationsNode["@_default"] ?? null;

  const organizations: ManifestOrganization[] = asArray<any>(organizationsNode.organization).map(
    (org) => ({
      identifier: org["@_identifier"] ?? "",
      title: typeof org.title === "string" ? org.title : org.title?.["#text"],
      items: parseItems(org.item),
    })
  );

  const resourcesNode = manifest.resources;
  if (!resourcesNode) {
    throw new ManifestParseError("Missing required <resources> element");
  }
  const resources: ManifestResource[] = asArray<any>(resourcesNode.resource).map((res) => ({
    identifier: res["@_identifier"] ?? "",
    type: res["@_type"],
    scormType: res["@_adlcp:scormtype"] ?? res["@_adlcp:scormType"],
    href: res["@_href"],
    files: asArray<any>(res.file).map((f) => f["@_href"]).filter(Boolean),
  }));

  return {
    identifier: manifest["@_identifier"] ?? null,
    schemaVersionRaw,
    scormVersion: detectScormVersion(schemaVersionRaw, xml),
    defaultOrganizationId,
    organizations,
    resources,
    usesSequencing: /imsss:sequencing|imsss:objectives/i.test(xml),
    raw,
  };
}

export function serializeManifest(raw: unknown): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    format: true,
    suppressEmptyNode: true,
  });
  return `<?xml version="1.0" standalone="no" ?>\n${builder.build(raw)}`;
}

// All item identifierrefs across the tree — these are the
// directly-launchable resources (vs. resources only pulled in as a
// <dependency> of another resource, which must stay type="asset").
export function collectDirectlyReferencedIdentifiers(organizations: ManifestOrganization[]): Set<string> {
  const ids = new Set<string>();
  function walk(items: ManifestItem[]) {
    for (const item of items) {
      if (item.identifierref) ids.add(item.identifierref);
      walk(item.children);
    }
  }
  for (const org of organizations) walk(org.items);
  return ids;
}
