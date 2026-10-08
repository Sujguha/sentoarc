import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, user as userTable, subscription, meteredUsageEvent } from "../src/lib/db/schema";
import { computeMbBilled, chargeForUpload } from "../src/lib/billing/prepaid-balance";

async function seedJobAndPackage(): Promise<{ jobId: string; packageId: string; ownerId: string }> {
  const db = createDb(env.DB);
  const now = new Date();
  const userId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const packageId = crypto.randomUUID();

  await db.insert(userTable).values({
    id: userId,
    name: "Test",
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(job).values({
    id: jobId,
    ownerType: "user",
    ownerId: userId,
    createdByUserId: userId,
    sourceType: "single",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(pkg).values({
    id: packageId,
    jobId,
    originalFilename: "course.zip",
    r2KeyUpload: `uploads/user/${userId}/${jobId}/${packageId}/original.zip`,
    createdAt: now,
    updatedAt: now,
  });

  return { jobId, packageId, ownerId: userId };
}

async function seedBalance(ownerId: string, balanceCents: number): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date();
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType: "user",
    ownerId,
    tier: "project_pack",
    status: "active",
    balanceCents,
    seats: 1,
    createdAt: now,
    updatedAt: now,
  });
}

describe("computeMbBilled", () => {
  it("rounds up a partial MB to a whole unit", () => {
    expect(computeMbBilled(1)).toBe(1);
    expect(computeMbBilled(1024 * 1024 - 1)).toBe(1);
  });

  it("bills an exact multiple of 1MB at that many units", () => {
    expect(computeMbBilled(5 * 1024 * 1024)).toBe(5);
  });

  it("rounds a value just over a whole MB up to the next one", () => {
    expect(computeMbBilled(5 * 1024 * 1024 + 1)).toBe(6);
  });
});

describe("chargeForUpload", () => {
  it("deducts the cost and records a ledger row when the balance is sufficient", async () => {
    const { jobId, packageId, ownerId } = await seedJobAndPackage();
    await seedBalance(ownerId, 1000); // €10.00
    const db = createDb(env.DB);

    const result = await chargeForUpload(db, {
      ownerType: "user",
      ownerId,
      jobId,
      packageId,
      sizeBytes: 3 * 1024 * 1024, // 3 MB
      unitPriceCents: 1,
    });

    expect(result).toMatchObject({ ok: true, mbBilled: 3, costCents: 3, balanceCents: 997 });

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.ownerId, ownerId))
      .limit(1);
    expect(row?.balanceCents).toBe(997);

    const [event] = await db.select().from(meteredUsageEvent).where(eq(meteredUsageEvent.packageId, packageId)).limit(1);
    expect(event).toMatchObject({ mbBilled: 3, sizeBytes: 3 * 1024 * 1024, stripeEventId: null });
  });

  it("succeeds when the balance exactly equals the cost (boundary: >=, not >)", async () => {
    const { jobId, packageId, ownerId } = await seedJobAndPackage();
    await seedBalance(ownerId, 5); // exactly 5 cents
    const db = createDb(env.DB);

    const result = await chargeForUpload(db, {
      ownerType: "user",
      ownerId,
      jobId,
      packageId,
      sizeBytes: 5 * 1024 * 1024,
      unitPriceCents: 1,
    });

    expect(result).toMatchObject({ ok: true, costCents: 5, balanceCents: 0 });
  });

  it("fails without deducting anything when the balance is insufficient", async () => {
    const { jobId, packageId, ownerId } = await seedJobAndPackage();
    await seedBalance(ownerId, 2); // 2 cents -- not enough for a 3-cent upload
    const db = createDb(env.DB);

    const result = await chargeForUpload(db, {
      ownerType: "user",
      ownerId,
      jobId,
      packageId,
      sizeBytes: 3 * 1024 * 1024,
      unitPriceCents: 1,
    });

    expect(result).toMatchObject({ ok: false, mbBilled: 3, costCents: 3, balanceCents: 2 });

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.ownerId, ownerId))
      .limit(1);
    expect(row?.balanceCents).toBe(2); // untouched

    const events = await db.select().from(meteredUsageEvent).where(eq(meteredUsageEvent.packageId, packageId));
    expect(events).toHaveLength(0); // no ledger row for a charge that never happened
  });

  it("reports a zero balance for an owner with no subscription row at all", async () => {
    const { jobId, packageId, ownerId } = await seedJobAndPackage();
    // Deliberately no seedBalance call -- this owner has never topped up.
    const db = createDb(env.DB);

    const result = await chargeForUpload(db, {
      ownerType: "user",
      ownerId,
      jobId,
      packageId,
      sizeBytes: 1024 * 1024,
      unitPriceCents: 1,
    });

    expect(result).toMatchObject({ ok: false, balanceCents: 0 });
  });

  it("lets only as many concurrent charges succeed as the balance actually covers", async () => {
    const { jobId, ownerId } = await seedJobAndPackage();
    await seedBalance(ownerId, 5); // covers exactly 5 one-cent charges
    const db = createDb(env.DB);

    // Each concurrent charge is a separate upload (its own package row,
    // as a real upload always is -- meteredUsageEvent.packageId is a
    // foreign key, so an ad-hoc id without a real pkg row would fail
    // the ledger insert on every success).
    const now = new Date();
    const packageIds = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const packageId = crypto.randomUUID();
        await db.insert(pkg).values({
          id: packageId,
          jobId,
          originalFilename: "course.zip",
          r2KeyUpload: `uploads/user/${ownerId}/${jobId}/${packageId}/original.zip`,
          createdAt: now,
          updatedAt: now,
        });
        return packageId;
      })
    );

    // 10 concurrent 1-cent charges against a 5-cent balance -- the
    // conditional UPDATE (balance_cents >= cost in the WHERE clause)
    // must let exactly 5 succeed, not let them all read a stale balance
    // and over-deduct into negative.
    const results = await Promise.all(
      packageIds.map((packageId) =>
        chargeForUpload(createDb(env.DB), {
          ownerType: "user",
          ownerId,
          jobId,
          packageId,
          sizeBytes: 1024 * 1024,
          unitPriceCents: 1,
        })
      )
    );

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(5);

    const [row] = await db.select().from(subscription).where(eq(subscription.ownerId, ownerId)).limit(1);
    expect(row?.balanceCents).toBe(0);
  });
});
