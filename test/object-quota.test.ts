import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { subscription, user as userTable } from "../src/lib/db/schema";
import { peekObjectsRemaining, consumeObject, refundObject } from "../src/lib/billing/object-quota";

const FREE_OBJECT_LIMIT = 3;

async function seedOwner(objectsRemaining: number, tier: "free" | "project_pack" | "enterprise" = "project_pack"): Promise<string> {
  const db = createDb(env.DB);
  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(userTable).values({
    id: userId,
    name: "Test",
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType: "user",
    ownerId: userId,
    tier,
    status: "active",
    objectsRemaining,
    seats: 1,
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}

describe("peekObjectsRemaining", () => {
  it("returns the free default for an owner with no subscription row at all", async () => {
    const db = createDb(env.DB);
    const result = await peekObjectsRemaining(db, { ownerType: "user", ownerId: crypto.randomUUID() }, FREE_OBJECT_LIMIT);
    expect(result).toBe(FREE_OBJECT_LIMIT);
  });

  it("returns the stored objectsRemaining when a row exists, without writing anything", async () => {
    const ownerId = await seedOwner(42);
    const db = createDb(env.DB);
    const result = await peekObjectsRemaining(db, { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT);
    expect(result).toBe(42);

    // Still no row created for a *different* never-seen owner just by peeking.
    const strangerId = crypto.randomUUID();
    await peekObjectsRemaining(db, { ownerType: "user", ownerId: strangerId }, FREE_OBJECT_LIMIT);
    const rows = await db.select().from(subscription).where(eq(subscription.ownerId, strangerId));
    expect(rows).toHaveLength(0);
  });
});

describe("consumeObject", () => {
  it("lazily creates a free-tier row with the full default quota on a first-ever consumption", async () => {
    const ownerId = crypto.randomUUID();
    const db = createDb(env.DB);

    const result = await consumeObject(db, { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT);

    expect(result).toMatchObject({ ok: true, objectsRemaining: FREE_OBJECT_LIMIT - 1 });
    const [row] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(row).toMatchObject({ tier: "free", objectsRemaining: FREE_OBJECT_LIMIT - 1 });
  });

  it("decrements an existing row by exactly one", async () => {
    const ownerId = await seedOwner(5);
    const db = createDb(env.DB);

    const result = await consumeObject(db, { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT);

    expect(result).toMatchObject({ ok: true, objectsRemaining: 4 });
  });

  it("succeeds when exactly one object remains (boundary: >=1, not >1)", async () => {
    const ownerId = await seedOwner(1);
    const db = createDb(env.DB);

    const result = await consumeObject(db, { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT);

    expect(result).toMatchObject({ ok: true, objectsRemaining: 0 });
  });

  it("fails without decrementing anything when the quota is already at zero", async () => {
    const ownerId = await seedOwner(0);
    const db = createDb(env.DB);

    const result = await consumeObject(db, { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT);

    expect(result).toMatchObject({ ok: false, objectsRemaining: 0 });
    const [row] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(row?.objectsRemaining).toBe(0); // untouched
  });

  it("lets only as many concurrent consumptions succeed as the quota actually covers", async () => {
    const ownerId = await seedOwner(5);
    const db = createDb(env.DB);

    // 10 concurrent 1-object charges against a quota of 5 -- the
    // conditional UPDATE (objects_remaining >= 1 in the WHERE clause)
    // must let exactly 5 succeed, not let them all read a stale value
    // and over-deduct into negative.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeObject(createDb(env.DB), { ownerType: "user", ownerId }, FREE_OBJECT_LIMIT))
    );

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(5);

    const [row] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(row?.objectsRemaining).toBe(0);
  });
});

describe("refundObject", () => {
  it("gives back one object to an existing row", async () => {
    const ownerId = await seedOwner(2);
    const db = createDb(env.DB);

    await refundObject(db, { ownerType: "user", ownerId });

    const [row] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(row?.objectsRemaining).toBe(3);
  });
});
