import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, packageIssue, subscription, user } from "../src/lib/db/schema";
import { buildZip, listZipEntries, strToU8 } from "../src/lib/scorm/zip-utils";
import { processPackageMessage } from "../src/lib/queue-consumer";
import { buildFixtureZip, corruptCompressedData } from "./scorm/helpers";

async function seedJobAndPackage(
  tier: "free" | "pro" | "enterprise",
  bytes: Uint8Array
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
  it("rejects a bulk ZIP-of-ZIPs for a free-tier owner", async () => {
    const { jobId, packageId, r2Key } = await seedJobAndPackage("free", buildZipOfZips());
    const db = createDb(env.DB);

    await processPackageMessage({ type: "process", jobId, packageId, r2Key }, env);

    const [pkgRow] = await db.select().from(pkg).where(eq(pkg.id, packageId)).limit(1);
    expect(pkgRow?.status).toBe("failed");
    expect(pkgRow?.errorMessage).toMatch(/pro plan/i);

    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
    expect(jobRow?.status).toBe("failed");
    expect(jobRow?.totalPackages).toBe(1);
  });

  it("expands a bulk ZIP-of-ZIPs into one package per inner ZIP for a pro-tier owner", async () => {
    const { jobId, packageId, r2Key } = await seedJobAndPackage("pro", buildZipOfZips());
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
    const { jobId, packageId, r2Key } = await seedJobAndPackage("pro", corruptedContainer);
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
    const { jobId, packageId, r2Key } = await seedJobAndPackage("pro", bytes);
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
