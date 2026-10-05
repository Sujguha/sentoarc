import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { job, pkg, usageCounter } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier } from "../middleware/require-plan";
import type { AppBindings } from "../types/hono";
import type { ProcessingQueueMessage } from "../types/env";

export const uploadsRoute = new Hono<AppBindings>();

// Uploads are routed through the Worker rather than presigned directly to
// R2 (the original design): that needs separate R2 API credentials we
// don't have configured, and SCORM packages from SEN are comfortably
// under the size cap here, so the simpler path is the right trade-off
// for now. Revisit with presigned uploads if bulk/larger files land.

uploadsRoute.post("/init", requireAuth, resolvePlanTier, async (c) => {
  const user = c.get("user");
  const tier = c.get("planTier");
  const body = await c.req.json<{ filename?: string; sizeBytes?: number }>().catch(() => null);

  if (!body?.filename || !body.filename.toLowerCase().endsWith(".zip")) {
    return c.json({ error: "filename_must_be_zip" }, 400);
  }
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return c.json({ error: "size_bytes_required" }, 400);
  }
  const maxBytes = Number(c.env.MAX_PACKAGE_SIZE_BYTES);
  if (sizeBytes > maxBytes) {
    return c.json({ error: "package_too_large", maxBytes }, 413);
  }

  const db = createDb(c.env.DB);

  if (tier === "free") {
    const freeLimit = Number(c.env.FREE_UPLOAD_LIMIT);
    const [row] = await db
      .select({ value: usageCounter.value })
      .from(usageCounter)
      .where(
        and(
          eq(usageCounter.ownerType, "user"),
          eq(usageCounter.ownerId, user.id),
          eq(usageCounter.metric, "free_uploads_used")
        )
      )
      .limit(1);
    if ((row?.value ?? 0) >= freeLimit) {
      return c.json({ error: "free_limit_reached", freeLimit }, 403);
    }
  }

  const now = new Date();
  const jobId = crypto.randomUUID();
  const packageId = crypto.randomUUID();
  const r2KeyUpload = `uploads/user/${user.id}/${jobId}/${packageId}/original.zip`;

  await db.insert(job).values({
    id: jobId,
    ownerType: "user",
    ownerId: user.id,
    createdByUserId: user.id,
    status: "queued",
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
    originalFilename: body.filename,
    r2KeyUpload,
    status: "pending",
    sizeBytes,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ jobId, packageId, uploadUrl: `/api/uploads/${packageId}/file` });
});

uploadsRoute.put("/:packageId/file", requireAuth, resolvePlanTier, async (c) => {
  const user = c.get("user");
  const tier = c.get("planTier");
  const packageId = c.req.param("packageId");
  const db = createDb(c.env.DB);

  const [row] = await db
    .select({
      jobId: pkg.jobId,
      status: pkg.status,
      r2KeyUpload: pkg.r2KeyUpload,
      ownerId: job.ownerId,
    })
    .from(pkg)
    .innerJoin(job, eq(pkg.jobId, job.id))
    .where(eq(pkg.id, packageId))
    .limit(1);

  if (!row || row.ownerId !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.status !== "pending") {
    return c.json({ error: "already_uploaded" }, 409);
  }

  const body = await c.req.arrayBuffer();
  const maxBytes = Number(c.env.MAX_PACKAGE_SIZE_BYTES);
  if (body.byteLength === 0) {
    return c.json({ error: "empty_upload" }, 400);
  }
  if (body.byteLength > maxBytes) {
    return c.json({ error: "package_too_large", maxBytes }, 413);
  }

  if (tier === "free") {
    const freeLimit = Number(c.env.FREE_UPLOAD_LIMIT);
    await db
      .insert(usageCounter)
      .values({ ownerType: "user", ownerId: user.id, metric: "free_uploads_used", value: 0, updatedAt: new Date() })
      .onConflictDoNothing();

    const updated = await db
      .update(usageCounter)
      .set({ value: sql`${usageCounter.value} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(usageCounter.ownerType, "user"),
          eq(usageCounter.ownerId, user.id),
          eq(usageCounter.metric, "free_uploads_used"),
          sql`${usageCounter.value} < ${freeLimit}`
        )
      )
      .returning({ value: usageCounter.value });

    if (updated.length === 0) {
      return c.json({ error: "free_limit_reached", freeLimit }, 403);
    }
  }

  await c.env.PACKAGES_BUCKET.put(row.r2KeyUpload, body);

  const now = new Date();
  await db.update(pkg).set({ status: "queued", updatedAt: now }).where(eq(pkg.id, packageId));
  await db.update(job).set({ status: "processing", updatedAt: now }).where(eq(job.id, row.jobId));

  const message: ProcessingQueueMessage = {
    type: "process",
    jobId: row.jobId,
    packageId,
    r2Key: row.r2KeyUpload,
  };
  await c.env.PACKAGE_QUEUE.send(message);

  return c.json({ ok: true, jobId: row.jobId, packageId });
});
