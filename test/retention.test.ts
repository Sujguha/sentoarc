import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, packageIssue, user } from "../src/lib/db/schema";
import {
  computeRetentionExpiresAt,
  deleteJobAndArtifacts,
  purgeExpiredJobs,
  sweepAbandonedUploads,
} from "../src/lib/retention";

async function seedUser(): Promise<string> {
  const db = createDb(env.DB);
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(user).values({
    id,
    name: "Test Owner",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedJob(opts: {
  ownerId: string;
  status: "queued" | "processing" | "completed" | "completed_with_errors" | "failed";
  retentionExpiresAt: Date | null;
  createdAt: Date;
  withPackage?: boolean;
}): Promise<{ jobId: string; packageId: string; r2Key: string }> {
  const db = createDb(env.DB);
  const jobId = crypto.randomUUID();
  const packageId = crypto.randomUUID();
  const r2Key = `uploads/user/${opts.ownerId}/${jobId}/${packageId}/original.zip`;

  await db.insert(job).values({
    id: jobId,
    ownerType: "user",
    ownerId: opts.ownerId,
    createdByUserId: opts.ownerId,
    status: opts.status,
    sourceType: "single",
    totalPackages: 1,
    completedPackages: opts.status === "completed" ? 1 : 0,
    failedPackages: 0,
    retentionExpiresAt: opts.retentionExpiresAt,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });

  if (opts.withPackage !== false) {
    await db.insert(pkg).values({
      id: packageId,
      jobId,
      originalFilename: "course.zip",
      r2KeyUpload: r2Key,
      status: "pass",
      sizeBytes: 123,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    });
    await env.PACKAGES_BUCKET.put(r2Key, new Uint8Array([1, 2, 3]));
    await db.insert(packageIssue).values({
      id: crypto.randomUUID(),
      packageId,
      severity: "info",
      code: "TEST_ISSUE",
      message: "just a test issue",
      fixApplied: false,
      createdAt: opts.createdAt,
    });
  }

  return { jobId, packageId, r2Key };
}

describe("computeRetentionExpiresAt", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("free tier: now + FREE_RETENTION_HOURS hours", () => {
    const expiresAt = computeRetentionExpiresAt("free", env, now);
    const expectedMs = now.getTime() + Number(env.FREE_RETENTION_HOURS) * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);
  });

  it("project_pack tier: now + PRO_RETENTION_DAYS days", () => {
    const expiresAt = computeRetentionExpiresAt("project_pack", env, now);
    const expectedMs = now.getTime() + Number(env.PRO_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);
  });

  it("enterprise tier with no override: same window as project_pack (no separate enterprise retention var)", () => {
    const proExpiry = computeRetentionExpiresAt("project_pack", env, now);
    const entExpiry = computeRetentionExpiresAt("enterprise", env, now);
    expect(entExpiry.getTime()).toBe(proExpiry.getTime());
  });

  it("a retention override takes priority over the tier default", () => {
    const expiresAt = computeRetentionExpiresAt("enterprise", env, now, 90);
    expect(expiresAt.getTime()).toBe(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it("an override of 0 days is honored, not treated as 'no override'", () => {
    // 0 is falsy but a legitimate (if aggressive) configured value --
    // must be distinguished from null, not coerced to the tier default.
    const expiresAt = computeRetentionExpiresAt("enterprise", env, now, 0);
    expect(expiresAt.getTime()).toBe(now.getTime());
  });
});

describe("deleteJobAndArtifacts", () => {
  it("removes the job, its packages, issues, and R2 objects", async () => {
    const ownerId = await seedUser();
    const now = new Date();
    const { jobId, packageId, r2Key } = await seedJob({ ownerId, status: "completed", retentionExpiresAt: null, createdAt: now });

    await deleteJobAndArtifacts(createDb(env.DB), env.PACKAGES_BUCKET, jobId);

    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(0);
    expect((await db.select().from(pkg).where(eq(pkg.id, packageId))).length).toBe(0);
    expect((await db.select().from(packageIssue).where(eq(packageIssue.packageId, packageId))).length).toBe(0);
    expect(await env.PACKAGES_BUCKET.get(r2Key)).toBeNull();
  });

  it("is a safe no-op for a job whose file was never uploaded (no R2 object ever written)", async () => {
    const ownerId = await seedUser();
    const now = new Date();
    const { jobId } = await seedJob({ ownerId, status: "queued", retentionExpiresAt: null, createdAt: now, withPackage: false });

    // Reservation only: a package row exists with a computed r2Key that
    // was never actually PUT to R2.
    const db = createDb(env.DB);
    const packageId = crypto.randomUUID();
    const r2Key = `uploads/user/${ownerId}/${jobId}/${packageId}/original.zip`;
    await db.insert(pkg).values({
      id: packageId,
      jobId,
      originalFilename: "never-uploaded.zip",
      r2KeyUpload: r2Key,
      status: "pending",
      sizeBytes: 100,
      createdAt: now,
      updatedAt: now,
    });

    await expect(deleteJobAndArtifacts(db, env.PACKAGES_BUCKET, jobId)).resolves.not.toThrow();
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(0);
  });
});

describe("purgeExpiredJobs", () => {
  it("purges a job whose retentionExpiresAt has passed", async () => {
    const ownerId = await seedUser();
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 60 * 1000);
    const { jobId } = await seedJob({ ownerId, status: "completed", retentionExpiresAt: past, createdAt: past });

    const count = await purgeExpiredJobs(createDb(env.DB), env.PACKAGES_BUCKET, now);

    expect(count).toBeGreaterThanOrEqual(1);
    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(0);
  });

  it("leaves a job whose retentionExpiresAt is still in the future", async () => {
    const ownerId = await seedUser();
    const now = new Date();
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    const { jobId } = await seedJob({ ownerId, status: "completed", retentionExpiresAt: future, createdAt: now });

    await purgeExpiredJobs(createDb(env.DB), env.PACKAGES_BUCKET, now);

    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(1);
  });

  it("leaves a job with no retentionExpiresAt set (predates this feature)", async () => {
    const ownerId = await seedUser();
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const { jobId } = await seedJob({ ownerId, status: "completed", retentionExpiresAt: null, createdAt: old });

    await purgeExpiredJobs(createDb(env.DB), env.PACKAGES_BUCKET, new Date());

    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(1);
  });
});

describe("sweepAbandonedUploads", () => {
  it("removes a job stuck at 'queued' well past the grace period", async () => {
    const ownerId = await seedUser();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { jobId } = await seedJob({
      ownerId,
      status: "queued",
      retentionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // retention far in the future -- only the abandonment sweep should catch this
      createdAt: twoHoursAgo,
      withPackage: false,
    });

    const count = await sweepAbandonedUploads(createDb(env.DB), env.PACKAGES_BUCKET, new Date());

    expect(count).toBeGreaterThanOrEqual(1);
    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(0);
  });

  it("leaves a recently-created 'queued' job alone (still within the grace period)", async () => {
    const ownerId = await seedUser();
    const now = new Date();
    const { jobId } = await seedJob({ ownerId, status: "queued", retentionExpiresAt: null, createdAt: now, withPackage: false });

    await sweepAbandonedUploads(createDb(env.DB), env.PACKAGES_BUCKET, now);

    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(1);
  });

  it("leaves an old job alone once it's past 'queued' (upload actually happened)", async () => {
    const ownerId = await seedUser();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { jobId } = await seedJob({
      ownerId,
      status: "processing",
      retentionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: twoHoursAgo,
    });

    await sweepAbandonedUploads(createDb(env.DB), env.PACKAGES_BUCKET, new Date());

    const db = createDb(env.DB);
    expect((await db.select().from(job).where(eq(job.id, jobId))).length).toBe(1);
  });
});
