import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { createDb, type Db } from "../lib/db/client";
import { job, pkg, packageIssue } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier, resolvePlanTierFor } from "../middleware/require-plan";
import { deleteJobAndArtifacts } from "../lib/retention";
import { getMemberRole } from "../lib/org-membership";
import { logAudit } from "../lib/audit";
import type { AppBindings, AuthedUser, OrgRole } from "../types/hono";

export const jobsRoute = new Hono<AppBindings>();

// A personal job is only visible to its owner (full control, modeled as
// "admin"). An org job is visible to any current member, at their org
// role -- this is what makes a job a "shared project": any teammate who
// was in the org when it ran can see it, not just whoever created it.
// Re-checked against D1 on every request, not cached on the job row.
export async function getJobAccessRole(
  db: Db,
  user: AuthedUser,
  jobRow: { ownerType: "user" | "org"; ownerId: string }
): Promise<OrgRole | null> {
  if (jobRow.ownerType === "user") {
    return jobRow.ownerId === user.id ? "admin" : null;
  }
  return getMemberRole(db, jobRow.ownerId, user.id);
}

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

// Scoped to the caller's current workspace (active org, or personal if
// none) -- switching active org switches which team's jobs you see here,
// the same mental model as a Slack/Notion workspace switcher.
jobsRoute.get("/", requireAuth, resolvePlanTier, async (c) => {
  const ownerType = c.get("ownerType");
  const ownerId = c.get("ownerId");
  const db = createDb(c.env.DB);
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);

  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerType, ownerType), eq(job.ownerId, ownerId)))
    .orderBy(desc(job.createdAt))
    .limit(limit);

  const jobIds = rows.map((r) => r.id);
  const filenamesByJob: Record<string, string[]> = {};
  if (jobIds.length > 0) {
    const packages = await db
      .select({ jobId: pkg.jobId, originalFilename: pkg.originalFilename })
      .from(pkg)
      .where(inArray(pkg.jobId, jobIds))
      .orderBy(pkg.createdAt);
    for (const p of packages) {
      (filenamesByJob[p.jobId] ??= []).push(p.originalFilename);
    }
  }

  return c.json({
    jobs: rows.map((r) => ({ ...r, filenames: filenamesByJob[r.id] ?? [] })),
  });
});

jobsRoute.get("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("id");
  const db = createDb(c.env.DB);

  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
  if (!jobRow || !(await getJobAccessRole(db, user, jobRow))) {
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
// on-screen report only, per the pricing page). Gated on the job's own
// owner's tier, not the caller's currently-active workspace -- those
// can differ (e.g. viewing a job in an org you belong to but aren't
// currently switched into).
jobsRoute.get("/:id/export.csv", requireAuth, async (c) => {
  const user = c.get("user");
  const jobId = c.req.param("id");
  const db = createDb(c.env.DB);

  const [jobRow] = await db.select().from(job).where(eq(job.id, jobId)).limit(1);
  if (!jobRow || !(await getJobAccessRole(db, user, jobRow))) {
    return c.json({ error: "not_found" }, 404);
  }

  const { tier } = await resolvePlanTierFor(db, jobRow.ownerType, jobRow.ownerId);
  if (tier !== "pro" && tier !== "enterprise") {
    return c.json({ error: "plan_upgrade_required", requiredPlans: ["pro", "enterprise"] }, 403);
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
      ownerType: job.ownerType,
      ownerId: job.ownerId,
      r2KeyFixed: pkg.r2KeyFixed,
      originalFilename: pkg.originalFilename,
    })
    .from(pkg)
    .innerJoin(job, eq(pkg.jobId, job.id))
    .where(and(eq(pkg.id, packageId), eq(job.id, jobId)))
    .limit(1);

  if (!row || !(await getJobAccessRole(db, user, row))) {
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
  const role = jobRow ? await getJobAccessRole(db, user, jobRow) : null;
  if (!jobRow || !role) {
    return c.json({ error: "not_found" }, 404);
  }
  if (role === "viewer") {
    return c.json({ error: "forbidden", message: "Viewers cannot delete jobs." }, 403);
  }

  if (jobRow.ownerType === "org") {
    await logAudit(db, {
      organizationId: jobRow.ownerId,
      actorUserId: user.id,
      action: "job.deleted",
      targetType: "job",
      targetId: jobId,
    });
  }

  await deleteJobAndArtifacts(db, c.env.PACKAGES_BUCKET, jobId);

  return c.json({ ok: true });
});
