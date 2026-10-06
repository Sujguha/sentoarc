import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { auditLog, organization, user } from "../src/lib/db/schema";
import { logAudit } from "../src/lib/audit";

// auditLog.organizationId/actorUserId are FK-constrained -- seed the
// rows they reference first, same as every other FK-backed fixture in
// this suite.
async function seedOrgAndActor(): Promise<{ organizationId: string; actorUserId: string }> {
  const db = createDb(env.DB);
  const now = new Date();
  const organizationId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  await db.insert(organization).values({ id: organizationId, name: "Test Org", createdAt: now });
  await db.insert(user).values({
    id: actorUserId,
    name: "Actor",
    email: `${actorUserId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return { organizationId, actorUserId };
}

describe("logAudit", () => {
  it("writes a row with the given fields, serializing metadata to JSON", async () => {
    const db = createDb(env.DB);
    const { organizationId, actorUserId } = await seedOrgAndActor();

    await logAudit(db, {
      organizationId,
      actorUserId,
      action: "job.created",
      targetType: "job",
      targetId: "job-123",
      metadata: { filename: "course.zip", sourceType: "single" },
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId,
      actorUserId,
      action: "job.created",
      targetType: "job",
      targetId: "job-123",
    });
    expect(JSON.parse(rows[0]!.metadataJson!)).toEqual({ filename: "course.zip", sourceType: "single" });
  });

  it("stores null for targetType/targetId/metadata when omitted", async () => {
    const db = createDb(env.DB);
    const { organizationId, actorUserId } = await seedOrgAndActor();

    await logAudit(db, { organizationId, actorUserId, action: "organization.created" });

    const [row] = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(row?.targetType).toBeNull();
    expect(row?.targetId).toBeNull();
    expect(row?.metadataJson).toBeNull();
  });
});
