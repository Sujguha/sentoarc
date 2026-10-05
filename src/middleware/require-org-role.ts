import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { member } from "../lib/db/schema";
import type { AppBindings } from "../types/hono";

type OrgRole = "admin" | "editor" | "viewer";

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
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, user.id)))
      .limit(1);

    if (!row || !allowed.includes(row.role as OrgRole)) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  });
}
