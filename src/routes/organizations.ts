import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { organization, auditLog } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { requireOrgRole } from "../middleware/require-org-role";
import { getMemberRole } from "../lib/org-membership";
import type { AppBindings } from "../types/hono";

export const organizationsRoute = new Hono<AppBindings>();

// The caller's current workspace, if any -- the AppShell upload header
// and the org switcher both read this to show "uploading as <org>" vs.
// "uploading as yourself". Re-verifies membership (activeOrganizationId
// alone, from the session, is only a hint of which org -- see
// resolvePlanTier) rather than just echoing the session field.
organizationsRoute.get("/active", requireAuth, async (c) => {
  const user = c.get("user");
  const activeOrganizationId = c.get("activeOrganizationId");
  if (!activeOrganizationId) {
    return c.json({ active: null });
  }

  const db = createDb(c.env.DB);
  const role = await getMemberRole(db, activeOrganizationId, user.id);
  if (!role) {
    return c.json({ active: null });
  }

  const [org] = await db.select().from(organization).where(eq(organization.id, activeOrganizationId)).limit(1);
  if (!org) {
    return c.json({ active: null });
  }

  return c.json({ active: { id: org.id, name: org.name, role } });
});

// Admin-only: the org's own activity trail (uploads, deletes, member
// changes). Every write auditLog has is logged from app code (jobs.ts,
// uploads.ts) or better-auth's organizationHooks (src/lib/auth) —
// nothing writes here besides those.
organizationsRoute.get("/:orgId/audit-log", requireAuth, requireOrgRole(["admin"]), async (c) => {
  const orgId = c.req.param("orgId");
  const db = createDb(c.env.DB);
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return c.json({
    entries: rows.map((r) => ({
      ...r,
      metadata: r.metadataJson ? JSON.parse(r.metadataJson) : null,
    })),
  });
});
