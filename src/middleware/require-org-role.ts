import { createMiddleware } from "hono/factory";
import { createDb } from "../lib/db/client";
import { getMemberRole } from "../lib/org-membership";
import type { AppBindings, OrgRole } from "../types/hono";

// Expects the organization id as the `:orgId` route param. Must run after
// requireAuth. Re-derives role from D1 on every request.
export function requireOrgRole(allowed: OrgRole[]) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const user = c.get("user");
    const orgId = c.req.param("orgId");
    if (!orgId) {
      return c.json({ error: "missing_org_id" }, 400);
    }

    const db = createDb(c.env.DB);
    const role = await getMemberRole(db, orgId, user.id);

    if (!role || !allowed.includes(role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set("orgRole", role);
    await next();
  });
}
