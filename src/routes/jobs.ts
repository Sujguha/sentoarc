import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { job, pkg, packageIssue } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier, requirePlan } from "../middleware/require-plan";
import { deleteJobAndArtifacts } from "../lib/retention";
import type { AppBindings } from "../types/hono";

export const jobsRoute = new Hono<AppBindings>();

// Wraps a field in double quotes (escaping embedded quotes) whenever it
// contains a comma, quote, or newline -- the minimal correct CSV
// escaping rule (RFC 4180), applied per-field rather than blanket
// quoting everything.
export function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

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

// CSV export of a job's report -- Pro/Enterprise only (Free gets the
// on-screen report only, per the pricing page).
jobsRoute.get("/:id/export.csv", requireAuth, resolvePlanTier, requirePlan(["pro", "enterprise"]), async (c) => {
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

  let csv = csvRow([
    "filename",
    "status",
    "input_format",
    "scorm_version_in",
    "scorm_version_out",
    "size_bytes",
    "error_message",
    "issue_count",
    "issues",
  ]);

  for (const p of packages) {
    const issues = issuesByPackage[p.id] ?? [];
    const issuesSummary = issues.map((i) => `[${i.severity}] ${i.code}: ${i.message}`).join(" | ");
    csv += csvRow([
      p.originalFilename,
      p.status,
      p.inputFormat,
      p.scormVersionIn,
      p.scormVersionOut,
      p.sizeBytes,
      p.errorMessage,
      issues.length,
      issuesSummary,
    ]);
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="job-${jobId}-report.csv"`,
    },
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

  await deleteJobAndArtifacts(db, c.env.PACKAGES_BUCKET, jobId);

  return c.json({ ok: true });
});
