import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { job, pkg, usageCounter } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier, requirePlan } from "../middleware/require-plan";
import { computeRetentionExpiresAt } from "../lib/retention";
import { logAudit } from "../lib/audit";
import { chargeForUpload } from "../lib/billing/prepaid-balance";
import type { AppBindings } from "../types/hono";
import type { Env, ProcessingQueueMessage } from "../types/env";

// Bulk upload (multiple files in one job) is a Pro/Enterprise feature —
// Free stays "single packages only" per the pricing page.
const MAX_BULK_FILES = 50;

export const uploadsRoute = new Hono<AppBindings>();

// Uploads are routed through the Worker rather than presigned directly to
// R2 (the original design): that needs separate R2 API credentials we
// don't have configured, and SCORM packages from SEN are comfortably
// under the size cap here, so the simpler path is the right trade-off
// for now. Revisit with presigned uploads if bulk/larger files land.

// This is a filename-extension allowlist, not the actual format check —
// the queue consumer sniffs real file content via detectFileType()
// before processing, so a mislabeled extension is rejected there, not
// trusted here.
export const ALLOWED_EXTENSIONS = [
  ".zip",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".html",
  ".htm",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".gif",
];

// Video gets the larger MAX_VIDEO_SIZE_BYTES cap (see env.d.ts) instead
// of the standard document/asset cap -- matches how Learning Arc itself
// treats video differently from everything else.
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

export function extensionOf(filename: string): string | null {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

export function maxBytesFor(extension: string, env: Pick<Env, "MAX_PACKAGE_SIZE_BYTES" | "MAX_VIDEO_SIZE_BYTES">): number {
  return Number(VIDEO_EXTENSIONS.includes(extension) ? env.MAX_VIDEO_SIZE_BYTES : env.MAX_PACKAGE_SIZE_BYTES);
}

uploadsRoute.post("/init", requireAuth, resolvePlanTier, async (c) => {
  const user = c.get("user");
  const tier = c.get("planTier");
  const ownerType = c.get("ownerType");
  const ownerId = c.get("ownerId");
  const orgRole = c.get("orgRole");

  // Uploading to a shared org project requires editor/admin — a viewer
  // can see the team's jobs but not add to them.
  if (ownerType === "org" && orgRole === "viewer") {
    return c.json({ error: "forbidden", message: "Viewers cannot upload to this organization." }, 403);
  }

  const body = await c.req.json<{ filename?: string; sizeBytes?: number }>().catch(() => null);
  if (!body?.filename) {
    return c.json({ error: "unsupported_file_type", allowed: ALLOWED_EXTENSIONS }, 400);
  }

  const extension = extensionOf(body.filename);
  if (!extension) {
    return c.json({ error: "unsupported_file_type", allowed: ALLOWED_EXTENSIONS }, 400);
  }
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return c.json({ error: "size_bytes_required" }, 400);
  }
  const maxBytes = maxBytesFor(extension, c.env);
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
          eq(usageCounter.ownerType, ownerType),
          eq(usageCounter.ownerId, ownerId),
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
  const r2KeyUpload = `uploads/${ownerType}/${ownerId}/${jobId}/${packageId}/original${extension}`;

  await db.insert(job).values({
    id: jobId,
    ownerType,
    ownerId,
    createdByUserId: user.id,
    status: "queued",
    sourceType: "single",
    totalPackages: 1,
    completedPackages: 0,
    failedPackages: 0,
    retentionExpiresAt: computeRetentionExpiresAt(tier, c.env, now, c.get("retentionDaysOverride")),
    createdAt: now,
    updatedAt: now,
  });
  if (ownerType === "org") {
    await logAudit(db, {
      organizationId: ownerId,
      actorUserId: user.id,
      action: "job.created",
      targetType: "job",
      targetId: jobId,
      metadata: { filename: body.filename, sourceType: "single" },
    });
  }
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

// Bulk upload: one job containing multiple packages, uploaded as
// separate files (as opposed to bulk_zip_of_zips, where one ZIP's
// entries are themselves ZIPs — that's auto-detected and expanded by the
// queue consumer instead). Each returned uploadUrl is the same
// PUT /:packageId/file endpoint used by a single upload.
uploadsRoute.post("/bulk/init", requireAuth, resolvePlanTier, requirePlan(["pro", "enterprise", "metered"]), async (c) => {
  const user = c.get("user");
  const tier = c.get("planTier");
  const ownerType = c.get("ownerType");
  const ownerId = c.get("ownerId");
  const orgRole = c.get("orgRole");

  if (ownerType === "org" && orgRole === "viewer") {
    return c.json({ error: "forbidden", message: "Viewers cannot upload to this organization." }, 403);
  }

  const body = await c.req.json<{ files?: { filename?: string; sizeBytes?: number }[] }>().catch(() => null);

  if (!body?.files || !Array.isArray(body.files) || body.files.length === 0) {
    return c.json({ error: "files_required" }, 400);
  }
  if (body.files.length > MAX_BULK_FILES) {
    return c.json({ error: "too_many_files", maxFiles: MAX_BULK_FILES }, 400);
  }

  const prepared: { filename: string; sizeBytes: number; extension: string }[] = [];
  for (const file of body.files) {
    if (!file?.filename) {
      return c.json({ error: "unsupported_file_type", allowed: ALLOWED_EXTENSIONS }, 400);
    }
    const extension = extensionOf(file.filename);
    if (!extension) {
      return c.json({ error: "unsupported_file_type", allowed: ALLOWED_EXTENSIONS }, 400);
    }
    const sizeBytes = Number(file.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return c.json({ error: "size_bytes_required" }, 400);
    }
    const maxBytes = maxBytesFor(extension, c.env);
    if (sizeBytes > maxBytes) {
      return c.json({ error: "package_too_large", maxBytes, filename: file.filename }, 413);
    }
    prepared.push({ filename: file.filename, sizeBytes, extension });
  }

  const db = createDb(c.env.DB);
  const now = new Date();
  const jobId = crypto.randomUUID();

  await db.insert(job).values({
    id: jobId,
    ownerType,
    ownerId,
    createdByUserId: user.id,
    status: "queued",
    sourceType: "bulk_multi",
    totalPackages: prepared.length,
    completedPackages: 0,
    failedPackages: 0,
    retentionExpiresAt: computeRetentionExpiresAt(tier, c.env, now, c.get("retentionDaysOverride")),
    createdAt: now,
    updatedAt: now,
  });
  if (ownerType === "org") {
    await logAudit(db, {
      organizationId: ownerId,
      actorUserId: user.id,
      action: "job.created",
      targetType: "job",
      targetId: jobId,
      metadata: { fileCount: prepared.length, sourceType: "bulk_multi" },
    });
  }

  const packages = [];
  for (const file of prepared) {
    const packageId = crypto.randomUUID();
    const r2KeyUpload = `uploads/${ownerType}/${ownerId}/${jobId}/${packageId}/original${file.extension}`;
    await db.insert(pkg).values({
      id: packageId,
      jobId,
      originalFilename: file.filename,
      r2KeyUpload,
      status: "pending",
      sizeBytes: file.sizeBytes,
      createdAt: now,
      updatedAt: now,
    });
    packages.push({ packageId, filename: file.filename, uploadUrl: `/api/uploads/${packageId}/file` });
  }

  return c.json({ jobId, packages });
});

uploadsRoute.put("/:packageId/file", requireAuth, resolvePlanTier, async (c) => {
  const tier = c.get("planTier");
  const ownerType = c.get("ownerType");
  const ownerId = c.get("ownerId");
  const orgRole = c.get("orgRole");
  const packageId = c.req.param("packageId");
  const db = createDb(c.env.DB);

  const [row] = await db
    .select({
      jobId: pkg.jobId,
      status: pkg.status,
      r2KeyUpload: pkg.r2KeyUpload,
      originalFilename: pkg.originalFilename,
      ownerType: job.ownerType,
      ownerId: job.ownerId,
    })
    .from(pkg)
    .innerJoin(job, eq(pkg.jobId, job.id))
    .where(eq(pkg.id, packageId))
    .limit(1);

  // Must be acting as the same owner (personal, or the same org) this
  // reservation was created under -- any editor/admin in that org can
  // complete a teammate's reservation (shared projects), but someone
  // outside the org, or a viewer within it, cannot.
  if (!row || row.ownerType !== ownerType || row.ownerId !== ownerId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (ownerType === "org" && orgRole === "viewer") {
    return c.json({ error: "forbidden", message: "Viewers cannot upload to this organization." }, 403);
  }
  if (row.status !== "pending") {
    return c.json({ error: "already_uploaded" }, 409);
  }

  const body = await c.req.arrayBuffer();
  const maxBytes = maxBytesFor(extensionOf(row.originalFilename) ?? "", c.env);
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
      .values({ ownerType, ownerId, metric: "free_uploads_used", value: 0, updatedAt: new Date() })
      .onConflictDoNothing();

    const updated = await db
      .update(usageCounter)
      .set({ value: sql`${usageCounter.value} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(usageCounter.ownerType, ownerType),
          eq(usageCounter.ownerId, ownerId),
          eq(usageCounter.metric, "free_uploads_used"),
          sql`${usageCounter.value} < ${freeLimit}`
        )
      )
      .returning({ value: usageCounter.value });

    if (updated.length === 0) {
      return c.json({ error: "free_limit_reached", freeLimit }, 403);
    }
  }

  if (tier === "metered") {
    // Prepaid: the balance must cover this upload BEFORE anything is
    // stored or processed -- unlike the old postpaid design, there is
    // no "process now, bill later" step here. A declined top-up is the
    // customer's problem to fix before uploading again, never ours to
    // collect on after the fact.
    const charge = await chargeForUpload(db, {
      ownerType,
      ownerId,
      jobId: row.jobId,
      packageId,
      sizeBytes: body.byteLength,
      unitPriceCents: Number(c.env.METERED_UNIT_PRICE_CENTS),
    });
    if (!charge.ok) {
      return c.json(
        {
          error: "insufficient_balance",
          costCents: charge.costCents,
          balanceCents: charge.balanceCents,
          message: `This upload would cost €${(charge.costCents / 100).toFixed(2)}, but your balance is only €${(charge.balanceCents / 100).toFixed(2)}. Top up to continue.`,
        },
        402
      );
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
