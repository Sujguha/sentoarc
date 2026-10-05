import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { job, pkg, packageIssue } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import type { AppBindings } from "../types/hono";

export const jobsRoute = new Hono<AppBindings>();

jobsRoute.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const db = createDb(c.env.DB);
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);

  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerType, "user"), eq(job.ownerId, user.id)))
    .orderBy(desc(job.createdAt))
    .limit(limit);

  return c.json({ jobs: rows });
});

jobsRoute.get("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("id");
  const db = createDb(c.env.DB);

  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
  if (!jobRow || jobRow.ownerId !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }

  const packages = await db.select().from(pkg).where(eq(pkg.jobId, jobId));
  const packageIds = packages.map((p) => p.id);

  const issuesByPackage: Record<string, (typeof packageIssue.$inferSelect)[]> = {};
  if (packageIds.length > 0) {
    const issues = await db.select().from(packageIssue).where(inArray(packageIssue.packageId, packageIds));
    for (const issue of issues) {
      (issuesByPackage[issue.packageId] ??= []).push(issue);
    }
  }

  return c.json({
    job: jobRow,
    packages: packages.map((p) => ({ ...p, issues: issuesByPackage[p.id] ?? [] })),
  });
});

jobsRoute.get("/:id/download/:packageId", requireAuth, async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("id");
  const packageId = c.req.param("packageId");
  const db = createDb(c.env.DB);

  const [row] = await db
    .select({
      ownerId: job.ownerId,
      r2KeyFixed: pkg.r2KeyFixed,
      originalFilename: pkg.originalFilename,
    })
    .from(pkg)
    .innerJoin(job, eq(pkg.jobId, job.id))
    .where(and(eq(pkg.id, packageId), eq(job.id, jobId)))
    .limit(1);

  if (!row || row.ownerId !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!row.r2KeyFixed) {
    return c.json({ error: "no_fixed_file_available" }, 404);
  }

  const object = await c.env.PACKAGES_BUCKET.get(row.r2KeyFixed);
  if (!object) {
    return c.json({ error: "file_missing_in_storage" }, 404);
  }

  const downloadName = `${row.originalFilename.replace(/\.zip$/i, "")}-fixed.zip`;
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
    },
  });
});

jobsRoute.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("id");
  const db = createDb(c.env.DB);

  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
  if (!jobRow || jobRow.ownerId !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }

  const packages = await db
    .select({ id: pkg.id, r2KeyUpload: pkg.r2KeyUpload, r2KeyFixed: pkg.r2KeyFixed })
    .from(pkg)
    .where(eq(pkg.jobId, jobId));

  const keysToDelete = packages.flatMap((p) => [p.r2KeyUpload, p.r2KeyFixed].filter((k): k is string => !!k));
  if (keysToDelete.length > 0) {
    await c.env.PACKAGES_BUCKET.delete(keysToDelete);
  }

  const packageIds = packages.map((p) => p.id);
  if (packageIds.length > 0) {
    await db.delete(packageIssue).where(inArray(packageIssue.packageId, packageIds));
    await db.delete(pkg).where(inArray(pkg.id, packageIds));
  }
  await db.delete(job).where(eq(job.id, jobId));

  return c.json({ ok: true });
});
