import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { organization, member, user as userTable } from "../src/lib/db/schema";
import { getJobAccessRole } from "../src/routes/jobs";
import type { AuthedUser } from "../src/types/hono";

function fakeUser(id: string): AuthedUser {
  return { id, email: `${id}@example.com`, name: "Test" };
}

// member.userId and job's ownerId-as-user are FK-constrained to a real
// user row; seed one for any userId this file hands to seedOrgMember.
async function ensureUser(userId: string) {
  const db = createDb(env.DB);
  const now = new Date();
  await db
    .insert(userTable)
    .values({ id: userId, name: "Test", email: `${userId}@example.com`, emailVerified: true, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

async function seedOrgMember(orgId: string, userId: string, role: "admin" | "editor" | "viewer") {
  const db = createDb(env.DB);
  const now = new Date();
  await ensureUser(userId);
  await db.insert(organization).values({ id: orgId, name: "Test Org", createdAt: now }).onConflictDoNothing();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: orgId, userId, role, createdAt: now });
}

describe("getJobAccessRole: personal jobs", () => {
  it("grants the owner full access ('admin')", async () => {
    const db = createDb(env.DB);
    const userId = crypto.randomUUID();
    const role = await getJobAccessRole(db, fakeUser(userId), { ownerType: "user", ownerId: userId });
    expect(role).toBe("admin");
  });

  it("denies a different user entirely", async () => {
    const db = createDb(env.DB);
    const ownerId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    const role = await getJobAccessRole(db, fakeUser(otherId), { ownerType: "user", ownerId });
    expect(role).toBeNull();
  });
});

describe("getJobAccessRole: org jobs (shared projects)", () => {
  it("grants access to any current member, at their role, regardless of who created the job", async () => {
    const db = createDb(env.DB);
    const orgId = crypto.randomUUID();
    const viewerId = crypto.randomUUID();
    await seedOrgMember(orgId, viewerId, "viewer");

    // A job created by someone else entirely in the same org.
    const role = await getJobAccessRole(db, fakeUser(viewerId), { ownerType: "org", ownerId: orgId });
    expect(role).toBe("viewer");
  });

  it("denies a user who is not a member of the owning org", async () => {
    const db = createDb(env.DB);
    const orgId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    // outsider never added as a member
    const role = await getJobAccessRole(db, fakeUser(outsiderId), { ownerType: "org", ownerId: orgId });
    expect(role).toBeNull();
  });

  it("denies access to a DIFFERENT org's job, even for an admin of some other org", async () => {
    const db = createDb(env.DB);
    const orgA = crypto.randomUUID();
    const orgB = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await seedOrgMember(orgA, userId, "admin");

    const role = await getJobAccessRole(db, fakeUser(userId), { ownerType: "org", ownerId: orgB });
    expect(role).toBeNull();
  });

  it("reflects the member's current role, not a stale one", async () => {
    const db = createDb(env.DB);
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await seedOrgMember(orgId, userId, "viewer");

    const before = await getJobAccessRole(db, fakeUser(userId), { ownerType: "org", ownerId: orgId });
    expect(before).toBe("viewer");

    await db
      .update(member)
      .set({ role: "admin" })
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));

    const after = await getJobAccessRole(db, fakeUser(userId), { ownerType: "org", ownerId: orgId });
    expect(after).toBe("admin");
  });
});
