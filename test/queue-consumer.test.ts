import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, packageIssue, processingStat, subscription, user } from "../src/lib/db/schema";
import { buildZip, listZipEntries, strToU8 } from "../src/lib/scorm/zip-utils";
import { processPackageMessage } from "../src/lib/queue-consumer";
import { buildFixtureZip, corruptCompressedData } from "./scorm/helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

// expandZipOfZips (queue-consumer.ts) really enqueues each expanded
// package via env.PACKAGE_QUEUE.send() for the real deployed worker to
// pick up later. In this test environment, wrangler.toml's real queue
// consumer binding means miniflare actually delivers that message in
// the background -- racing a test that (as every test below does)
// immediately re-invokes processPackageMessage itself for each
// expanded package, and sometimes landing after the test file's
// isolated storage has already been torn down, which crashes the
// whole run with an unrelated "Isolated storage failed" assertion.
// Stubbed out since the real enqueue is always redundant here.
function stubQueueSend(): void {
  vi.spyOn(env.PACKAGE_QUEUE, "send").mockResolvedValue({} as QueueSendResponse);
}

async function seedJobAndPackage(
  tier: "free" | "project_pack" | "enterprise",
  bytes: Uint8Array,
  objectsRemaining?: number
): Promise<{ jobId: string; packageId: string; r2Key: string; ownerId: string }> {
  const db = createDb(env.DB);
  const now = new Date();
  const ownerId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const packageId = crypto.randomUUID();
  const r2Key = `uploads/user/${ownerId}/${jobId}/${packageId}/original.zip`;

  await db.insert(user).values({
    id: ownerId,
    name: "Test Owner",
    email: `${ownerId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType: "user",
    ownerId,
    tier,
    status: "active",
    ...(objectsRemaining !== undefined ? { objectsRemaining } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(job).values({
    id: jobId,
    ownerType: "user",
    ownerId,
    createdByUserId: ownerId,
    status: "processing",
    sourceType: "single",
    totalPackages: 1,
    completedPackages: 0,
    failedPackages: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(pkg).values({
    id: packageId,
    jobId,
    originalFilename: "bundle.zip",
    r2KeyUpload: r2Key,
    status: "queued",
    sizeBytes: bytes.length,
    createdAt: now,
    updatedAt: now,
  });
  await env.PACKAGES_BUCKET.put(r2Key, bytes);

  return { jobId, packageId, r2Key, ownerId };
}

function buildZipOfZips(): Uint8Array {
  // Both inner packages use the same valid fixture -- this test is about
  // the expansion plumbing (one package row per inner ZIP, correctly
  // processed afterward), not about manifest-fixing edge cases, which
  // are already covered by fixer.test.ts/validator.test.ts.
  const inner1 = buildFixtureZip("valid-1.2", ["index.html"]);
  const inner2 = buildFixtureZip("valid-1.2", ["index.html"]);
  return buildZip({
    "course-a.zip": [inner1, { level: 0 }],
    "course-b.zip": [inner2, { level: 0 }],
  });
}

describe("processPackageMessage: zip-of-zips expansion", () => {
  it("expands a bulk ZIP-of-ZIPs into one package per inner ZIP for a free-tier owner too", async () => {
    stubQueueSend();
    // Bulk is open to every tier now, just limited by the usual object
    // quota -- a free-tier owner with their full default quota can
    // still expand a small zip-of-zips.
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", buildZipOfZips());
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    expect(packages).toHaveLength(2);
    expect(packages.map((p) => p.originalFilename).sort()).toEqual(["course-a.zip", "course-b.zip"]);
  });

  it("expands a bulk ZIP-of-ZIPs into one package per inner ZIP for a project_pack-tier owner", async () => {
    stubQueueSend();
    const { jobId, packageId, r2Key } = await seedJobAndPackage("project_pack", buildZipOfZips());
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    // The container package row is replaced, not left behind.
    const [containerRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(containerRow).toBeUndefined();

    const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    expect(packages).toHaveLength(2);
    expect(packages.map((p) => p.originalFilename).sort()).toEqual(["course-a.zip", "course-b.zip"]);
    for (const p of packages) {
      expect(p.status).toBe("queued");
    }

    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(jobRow?.totalPackages).toBe(2);
    expect(jobRow?.sourceType).toBe("bulk_zip_of_zips");

    // Each expanded package resolves through the normal pipeline too.
    for (const p of packages) {
      await processPackageMessage({ type: "process", jobId, packageId: p.id, r2Key: p.r2KeyUpload }, env);
    }
    const finished = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    for (const p of finished) {
      expect(["pass", "fixed"]).toContain(p.status);
    }
    const [finalJob] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(finalJob?.status).toBe("completed");
  });

  it("refunds the container's charge, then stops expanding once the quota runs out", async () => {
    stubQueueSend();
    // 0 remaining represents an owner who had exactly 1 object and spent
    // it on the container's own upload -- expansion must refund that 1
    // (the container isn't a real deliverable) before charging per inner
    // package, so exactly 1 of the 2 inner zips should fit.
    const { jobId, packageId, r2Key, ownerId } = await seedJobAndPackage("free", buildZipOfZips(), 0);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    expect(packages).toHaveLength(1);
    expect(packages[0]?.originalFilename).toBe("course-a.zip");

    const [subRow] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(subRow?.objectsRemaining).toBe(0);
  });
});

describe("processPackageMessage: wrong/mismatched file type", () => {
  // The extension allowlist in uploads.ts (tested separately in
  // uploads.test.ts) is only a shallow first gate -- it trusts the
  // filename, not the content. This is the real guard: a file whose
  // actual bytes don't match any recognized format must still fail
  // cleanly here, end-to-end through the real pipeline, regardless of
  // what the uploader named it or claimed it was.
  it("fails cleanly when the uploaded content matches no recognized format at all", async () => {
    const plainText = strToU8("This is just a plain text file, not a SCORM package, PDF, MP4, or PPTX.");
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", plainText);
    const db = createDb(env.DB);

    await expect(processPackageMessage({ type: "process", jobId, packageId, r2Key }, env)).resolves.toBeUndefined();

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("failed");
    expect(pkgRow?.errorMessage).toMatch(/recognized format/i);

    const issues = await db.select().from(packageIssue).where(eq(packageIssue.packageId, packageId));
    expect(issues.some((i) => i.code === "UNSUPPORTED_FILE_TYPE")).toBe(true);

    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(jobRow?.status).toBe("failed");
  });

  // A zip file is the one format whose "is this really a zip" check and
  // "is this really a SCORM package" check are two different layers --
  // a well-formed zip with no imsmanifest.xml (e.g. someone zips up an
  // unrelated folder and uploads it) passes the zip-parsing layer fine
  // but still isn't usable content.
  it("fails cleanly for a well-formed ZIP that isn't a SCORM package, PPTX, or web bundle", async () => {
    const zip = buildZip({ "notes.txt": strToU8("just some notes, not a course") });
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", zip);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("failed");
    expect(pkgRow?.errorMessage).toMatch(/recognized format/i);
  });
});

describe("processPackageMessage: corrupted/unreadable input", () => {
  // Regression test: file-type detection only scans a zip's central
  // directory (never inflates -- see listZipEntries), so a zip whose
  // headers parse fine but whose actual compressed data is
  // truncated/corrupted reaches fixPackage undetected. Before this fix,
  // the real decompress attempt inside fixPackage threw uncaught,
  // which the queue handler (src/index.ts) treats as a transient
  // infra failure worth retrying -- a corrupted upload would retry 3
  // times, dead-letter, and leave the job stuck "processing" forever
  // with no error ever shown to the user.
  it("marks a corrupted SCORM zip as a clean failure instead of crashing the pipeline", async () => {
    const corrupted = corruptCompressedData(buildFixtureZip("valid-1.2", ["index.html"]));
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", corrupted);
    const db = createDb(env.DB);

    await expect(processPackageMessage({ type: "process", jobId, packageId, r2Key }, env)).resolves.toBeUndefined();

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("failed");
    expect(pkgRow?.errorMessage).toMatch(/corrupt/i);

    const issues = await db.select().from(packageIssue).where(eq(packageIssue.packageId, packageId));
    expect(issues.some((i) => i.code === "CORRUPT_ZIP")).toBe(true);

    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(jobRow?.status).toBe("failed");
  });

  // Same underlying issue (decompressSingleEntry really inflates, unlike
  // the header scan that discovered the inner .zip names), but for the
  // bulk zip-of-zips expansion loop: one corrupted inner package must
  // not abort extracting the rest of the upload.
  it("skips a corrupted inner ZIP within a bulk upload without losing the other valid ones", async () => {
    // "bad.zip" is deliberately left at the container's default deflate
    // level (unlike the normal convention of storing inner .zips with
    // {level: 0}, since they're already-compressed data) specifically so
    // the container itself has real compressed data to corrupt for this
    // entry -- that's what makes decompressSingleEntry actually inflate
    // (and therefore actually throw) when extracting it, rather than
    // just copying stored bytes straight through.
    const container = buildZip({
      "bad.zip": strToU8("not a real inner package, just something deflate-compressible".repeat(5)),
      "good.zip": [buildFixtureZip("valid-1.2", ["index.html"]), { level: 0 }],
    });
    const corruptedContainer = corruptCompressedData(container);
    stubQueueSend();
    const { jobId, packageId, r2Key } = await seedJobAndPackage("project_pack", corruptedContainer);
    const db = createDb(env.DB);

    await expect(processPackageMessage({ type: "process", jobId, packageId, r2Key }, env)).resolves.toBeUndefined();

    const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    expect(packages).toHaveLength(1);
    expect(packages[0]?.originalFilename).toBe("good.zip");

    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(jobRow?.totalPackages).toBe(1);
  });
});

describe("processPackageMessage: streamed 'fixed' output reaches R2 intact", () => {
  // Regression test: buildFixedZipStream's output is a plain
  // ReadableStream with no declared length. R2's single-shot put()
  // rejects that outright ("must have a known length"), which would
  // silently break every package that actually needs a manifest fix
  // (the "pass" case is unaffected -- it reuses the original Uint8Array
  // verbatim, never touching this code path). This isn't specific to
  // the translation-path rule; any fix (e.g. scormtype correction)
  // takes the same streamed-upload path.
  it("stores a scormtype-fix package (unrelated to translation paths) correctly in R2", async () => {
    const bytes = buildFixtureZip("asset-scormtype", ["index.html"]);
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", bytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");
    expect(pkgRow?.r2KeyFixed).toBeTruthy();

    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    expect(fixedObject).not.toBeNull();
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames.sort()).toEqual(["imsmanifest.xml", "index.html"].sort());
  });
});

describe("processPackageMessage: translation-path rewrite gating", () => {
  it("does not apply the translation-path fix for a free-tier owner", async () => {
    const bytes = buildFixtureZip("translation-path-mismatch", ["index.html", "en-us/narration.mp3"]);
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", bytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("pass"); // no fix applied -> nothing to rebuild
  });

  it("applies the translation-path fix for a pro-tier owner", async () => {
    const bytes = buildFixtureZip("translation-path-mismatch", ["index.html", "en-us/narration.mp3"]);
    const { jobId, packageId, r2Key } = await seedJobAndPackage("project_pack", bytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");

    const issues = await db.select().from(packageIssue).where(eq(packageIssue.packageId, packageId));
    const issue = issues.find((i) => i.code === "TRANSLATION_PATH_MISMATCH");
    expect(issue?.fixApplied).toBe(true);

    // Round-trips correctly through R2 (exercises the multipart-upload
    // path for a streamed fixedZip, not just the DB status flip).
    expect(pkgRow?.r2KeyFixed).toBeTruthy();
    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    expect(fixedObject).not.toBeNull();
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames.sort()).toEqual(["en-us/narration.mp3", "imsmanifest.xml", "index.html"].sort());
  });
});

describe("processPackageMessage: wrap pipeline for newly supported formats", () => {
  // One representative per new category (image, audio, document, video) --
  // detect.test.ts/wrapper.test.ts already cover every format's detection
  // and wrapping in isolation; these confirm the two stages are wired
  // together correctly end-to-end through the real pipeline, landing in
  // R2 with the right inputFormat and a clean "fixed" status.
  it("wraps a PNG image upload as a SCORM package", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", pngBytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");
    expect(pkgRow?.inputFormat).toBe("png");
    expect(pkgRow?.r2KeyFixed).toBeTruthy();

    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames).toEqual(expect.arrayContaining(["imsmanifest.xml", "launch.html", "scormapi.js", "content.png"]));
  });

  it("wraps an MP3 audio upload as a SCORM package", async () => {
    const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00]); // ID3 tag
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", mp3Bytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");
    expect(pkgRow?.inputFormat).toBe("mp3");

    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames).toContain("content.mp3");
  });

  it("wraps a DOCX upload as a SCORM package", async () => {
    const zip = buildZip({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8("<document/>"),
    });
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", zip);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");
    expect(pkgRow?.inputFormat).toBe("docx");

    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames).toContain("content.docx");
  });

  it("wraps a WebM video upload as a SCORM package", async () => {
    const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", webmBytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("fixed");
    expect(pkgRow?.inputFormat).toBe("webm");

    const fixedObject = await env.PACKAGES_BUCKET.get(pkgRow!.r2KeyFixed!);
    const fixedBytes = new Uint8Array(await fixedObject!.arrayBuffer());
    const fixedNames = listZipEntries(fixedBytes).entries.map((e) => e.name);
    expect(fixedNames).toContain("content.webm");
  });
});

describe("processPackageMessage: processing stats", () => {
  // The Account/Admin "documents processed" stats read from
  // processingStat, not job/package directly, because those get purged
  // by retention -- this is the one place a row gets written, so every
  // terminal outcome (pass, fixed, failed) must land one here.
  it("records a processingStat row with the owner and size on a successful pass", async () => {
    const bytes = buildFixtureZip("valid-1.2", ["index.html"]);
    const { jobId, packageId, r2Key, ownerId } = await seedJobAndPackage("free", bytes);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("pass");

    const stats = await db.select().from(processingStat).where(eq(processingStat.ownerId, ownerId));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ ownerType: "user", ownerId, sizeBytes: bytes.length, status: "pass" });
  });

  it("records a processingStat row for a failed package too (it still consumed real processing)", async () => {
    const plainText = strToU8("not a recognized format");
    const { jobId, packageId, r2Key, ownerId } = await seedJobAndPackage("free", plainText);
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const stats = await db.select().from(processingStat).where(eq(processingStat.ownerId, ownerId));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ status: "failed", sizeBytes: plainText.length });
  });

  it("records one processingStat row per expanded package in a bulk ZIP-of-ZIPs, not one for the container", async () => {
    stubQueueSend();
    const { jobId, packageId, r2Key, ownerId } = await seedJobAndPackage("project_pack", buildZipOfZips());
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);
    const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
    for (const p of packages) {
      await processPackageMessage({ type: "process", jobId, packageId: p.id, r2Key: p.r2KeyUpload }, env);
    }

    const stats = await db.select().from(processingStat).where(eq(processingStat.ownerId, ownerId));
    expect(stats).toHaveLength(2); // the two inner packages -- never the container itself
  });
});
