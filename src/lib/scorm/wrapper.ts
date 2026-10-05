import type { Unzipped, Zippable } from "fflate";
import { strToU8 } from "./zip-utils";
import { SCORM_API_JS } from "./scormapi-runtime";
import type { DetectedFileType } from "./detect";

export interface WrapResult {
  title: string;
  files: Zippable;
}

// PDF/MP4/PPTX are already-compressed formats -- deflating them again in
// the output zip burns CPU for ~0% size benefit, and on a near-100MB file
// that's exactly what pushed a Worker invocation over its CPU budget.
// Storing them instead is a straight copy (plus a cheap CRC32 pass).
function stored(bytes: Uint8Array): [Uint8Array, { level: 0 }] {
  return [bytes, { level: 0 }];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "");
  const spaced = base.replace(/[_-]+/g, " ").trim();
  return spaced || "Untitled";
}

function buildManifest(title: string, contentHrefs: string[]): string {
  const fileEntries = ["launch.html", "scormapi.js", ...contentHrefs]
    .map((href) => `      <file href="${escapeXml(href)}"/>`)
    .join("\n");

  return `<?xml version="1.0" standalone="no" ?>
<manifest identifier="SENTOARC-WRAP-${crypto.randomUUID()}" version="1"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${escapeXml(title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${escapeXml(title)}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="launch.html">
${fileEntries}
    </resource>
  </resources>
</manifest>
`;
}

function buildLaunchPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
<script src="scormapi.js"></script>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #1e293b; }
  .content { max-width: 960px; margin: 0 auto; }
  .complete-btn { margin-top: 16px; padding: 10px 20px; background: #0f172a; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  iframe, video { width: 100%; border: none; }
</style>
</head>
<body>
  <div class="content">
    <h1>${escapeXml(title)}</h1>
    ${bodyHtml}
    <button class="complete-btn" onclick="window.SCORM && window.SCORM.markComplete()">Mark as Complete</button>
  </div>
</body>
</html>
`;
}

export function wrapAsPdf(title: string, pdfBytes: Uint8Array): WrapResult {
  const body = `<iframe src="content.pdf" style="height: 80vh;"></iframe>`;
  return {
    title,
    files: {
      "imsmanifest.xml": strToU8(buildManifest(title, ["content.pdf"])),
      "launch.html": strToU8(buildLaunchPage(title, body)),
      "scormapi.js": strToU8(SCORM_API_JS),
      "content.pdf": stored(pdfBytes),
    },
  };
}

export function wrapAsVideo(title: string, videoBytes: Uint8Array): WrapResult {
  const body = `<video id="scorm-video" controls style="max-height: 80vh;"><source src="content.mp4" type="video/mp4"></video>
    <script>
      document.getElementById("scorm-video").addEventListener("ended", function () {
        window.SCORM && window.SCORM.markComplete();
      });
    </script>`;
  return {
    title,
    files: {
      "imsmanifest.xml": strToU8(buildManifest(title, ["content.mp4"])),
      "launch.html": strToU8(buildLaunchPage(title, body)),
      "scormapi.js": strToU8(SCORM_API_JS),
      "content.mp4": stored(videoBytes),
    },
  };
}

// No slide-by-slide rendering: that needs a conversion engine (LibreOffice
// headless, a cloud API) which is a new dependency decision, not something
// to add silently. This gives a working, trackable SCORM package today.
export function wrapAsPptx(title: string, pptxBytes: Uint8Array): WrapResult {
  const body = `<p>This content is a PowerPoint presentation. <a href="content.pptx" download>Download the presentation</a> to view it, then mark this lesson complete below.</p>
    <p style="color: #64748b; font-size: 13px;">Note: in-browser slide playback isn't supported yet — this launch page links out to the file instead.</p>`;
  return {
    title,
    files: {
      "imsmanifest.xml": strToU8(buildManifest(title, ["content.pptx"])),
      "launch.html": strToU8(buildLaunchPage(title, body)),
      "scormapi.js": strToU8(SCORM_API_JS),
      "content.pptx": stored(pptxBytes),
    },
  };
}

export function wrapAsHtml(title: string, htmlBytes: Uint8Array): WrapResult {
  const body = `<iframe src="content/index.html" style="height: 80vh;"></iframe>`;
  return {
    title,
    files: {
      "imsmanifest.xml": strToU8(buildManifest(title, ["content/index.html"])),
      "launch.html": strToU8(buildLaunchPage(title, body)),
      "scormapi.js": strToU8(SCORM_API_JS),
      "content/index.html": htmlBytes,
    },
  };
}

function pickHtmlEntryPoint(files: Unzipped): string | null {
  const htmlFiles = Object.keys(files).filter((k) => /\.html?$/i.test(k));
  if (htmlFiles.length === 0) return null;
  const index = htmlFiles.find((k) => /(^|\/)index\.html?$/i.test(k));
  return index ?? htmlFiles.sort()[0] ?? null;
}

export function wrapAsHtmlZip(title: string, zipFiles: Unzipped): WrapResult {
  const entryPoint = pickHtmlEntryPoint(zipFiles);
  if (!entryPoint) {
    throw new Error("No HTML file found in the uploaded ZIP.");
  }

  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(zipFiles)) {
    files[`content/${path}`] = bytes;
  }
  const contentHrefs = Object.keys(files);

  const body = `<iframe src="content/${entryPoint}" style="height: 80vh;"></iframe>`;
  files["imsmanifest.xml"] = strToU8(buildManifest(title, contentHrefs));
  files["launch.html"] = strToU8(buildLaunchPage(title, body));
  files["scormapi.js"] = strToU8(SCORM_API_JS);

  return { title, files };
}

export function wrapAsScorm(type: Exclude<DetectedFileType, "scorm-zip" | "unknown">, bytes: Uint8Array, filename: string, zipFiles?: Unzipped): WrapResult {
  const title = titleFromFilename(filename);
  switch (type) {
    case "pdf":
      return wrapAsPdf(title, bytes);
    case "mp4":
      return wrapAsVideo(title, bytes);
    case "pptx":
      return wrapAsPptx(title, bytes);
    case "html":
      return wrapAsHtml(title, bytes);
    case "html-zip":
      if (!zipFiles) throw new Error("html-zip wrapping requires the unzipped file map.");
      return wrapAsHtmlZip(title, zipFiles);
  }
}
