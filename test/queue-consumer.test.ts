import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, subscription, user } from "../src/lib/db/schema";
import { buildZip } from "../src/lib/scorm/zip-utils";
import { processPackageMessage } from "../src/lib/queue-consumer";
import { buildFixtureZip } from "./scorm/helpers";

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
