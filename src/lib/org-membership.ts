import { eq, and } from "drizzle-orm";
import { member } from "./db/schema";
import type { Db } from "./db/client";
import type { OrgRole } from "../types/hono";

// Single source of truth for "is this user currently a member of this
// org, and what role" -- re-derived from D1 on every call (role can
// change, membership can be revoked) rather than trusted from the
// session or any client-sent value.
export async function getMemberRole(db: Db, organizationId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return (row?.role as OrgRole | undefined) ?? null;
}
