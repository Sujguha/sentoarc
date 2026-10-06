import { eq, inArray, lte, and } from "drizzle-orm";
import { job, pkg, packageIssue } from "./db/schema";
import type { Db } from "./db/client";
import type { Env } from "../types/env";
import type { HonoVariables } from "../types/hono";

// A reservation (POST /init created the job/package rows) whose file was
// never actually PUT stays at job.status "queued" forever -- it has no
// real uploaded data (the R2 key was computed but never written), so it
// doesn't wait out the tier's retention window; a short, fixed grace
// period for an upload the user simply never finished is enough.
const ABANDONED_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Tier (and any founder-set retentionDaysOverride) is already resolved
// by resolvePlanTier in the upload routes at the point a job is created
// -- no need to re-resolve it from D1 here. The override exists for
// Enterprise, which is sales-assisted rather than self-serve, so it's
// set by the founder (see the admin retention route), not configurable
// by the org itself.
export function computeRetentionExpiresAt(
  tier: HonoVariables["planTier"],
  env: Env,
  now: Date,
  retentionDaysOverride: number | null = null
): Date {
  if (retentionDaysOverride !== null) {
    return new Date(now.getTime() + retentionDaysOverride * 24 * 60 * 60 * 1000);
  }
  const ms =
    tier === "free"
      ? Number(env.FREE_RETENTION_HOURS) * 60 * 60 * 1000
      : Number(env.PRO_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

// Shared by the DELETE /api/jobs/:id route and both cron sweeps below --
// deletes a job's R2 objects (upload + fixed, where present; a key that
// was never actually written, e.g. an abandoned reservation, is a safe
// no-op to "delete") and every DB row under it.
export async function deleteJobAndArtifacts(db: Db, bucket: R2Bucket, jobId: string): Promise<void> {
  const packages = await db
    .select({ id: pkg.id, r2KeyUpload: pkg.r2KeyUpload, r2KeyFixed: pkg.r2KeyFixed })
    .from(pkg)
    .where(eq(pkg.jobId, jobId));

  const keysToDelete = packages.flatMap((p) => [p.r2KeyUpload, p.r2KeyFixed].filter((k): k is string => !!k));
  if (keysToDelete.length > 0) {
    await bucket.delete(keysToDelete);
  }

  const packageIds = packages.map((p) => p.id);
  if (packageIds.length > 0) {
    await db.delete(packageIssue).where(inArray(packageIssue.packageId, packageIds));
    await db.delete(pkg).where(inArray(pkg.id, packageIds));
  }
  await db.delete(job).where(eq(job.id, jobId));
}

// Jobs whose stored retentionExpiresAt (set at creation from the
// owner's tier at that time -- see computeRetentionExpiresAt) has
// passed. A job created before this feature shipped has
// retentionExpiresAt = NULL and is left alone rather than purged
// immediately on the next run.
export async function purgeExpiredJobs(db: Db, bucket: R2Bucket, now: Date): Promise<number> {
  const expired = await db
    .select({ id: job.id })
    .from(job)
    .where(and(lte(job.retentionExpiresAt, now)));

  for (const row of expired) {
    await deleteJobAndArtifacts(db, bucket, row.id);
  }
  return expired.length;
}

// Jobs still at status "queued" (no package's file was ever PUT -- see
// POST /api/uploads/init and PUT /api/uploads/:packageId/file) well
// past any reasonable time to complete that upload.
export async function sweepAbandonedUploads(db: Db, bucket: R2Bucket, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_MAX_AGE_MS);
  const abandoned = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.status, "queued"), lte(job.createdAt, cutoff)));

  for (const row of abandoned) {
    await deleteJobAndArtifacts(db, bucket, row.id);
  }
  return abandoned.length;
}
