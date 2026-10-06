import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { job, pkg, user as userTable, meteredUsageEvent } from "../src/lib/db/schema";
import { computeMbBilled, reportMeteredUsage } from "../src/lib/billing/metered-usage";

async function seedJobAndPackage(): Promise<{ jobId: string; packageId: string }> {
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

  return { jobId, packageId };
}

function fakeStripe(overrides: Partial<{ create: ReturnType<typeof vi.fn> }> = {}): Stripe {
  return {
    billing: {
      meterEvents: {
        create:
          overrides.create ??
          vi.fn(async (params: Stripe.Billing.MeterEventCreateParams) => ({
            object: "billing.meter_event",
            created: Math.floor(Date.now() / 1000),
            event_name: params.event_name,
            identifier: params.identifier ?? "generated-id",
            livemode: false,
            payload: params.payload,
            timestamp: Math.floor(Date.now() / 1000),
          })),
      },
    },
  } as unknown as Stripe;
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

describe("reportMeteredUsage", () => {
  it("records a usage event and reports it to Stripe with the package id as the idempotency key", async () => {
    const { jobId, packageId } = await seedJobAndPackage();
    const db = createDb(env.DB);
    const create = vi.fn(async (params: Stripe.Billing.MeterEventCreateParams) => ({
      object: "billing.meter_event" as const,
      created: 0,
      event_name: params.event_name,
      identifier: params.identifier ?? "x",
      livemode: false,
      payload: params.payload,
      timestamp: 0,
    }));
    const stripe = fakeStripe({ create });

    await reportMeteredUsage(stripe, db, {
      ownerType: "user",
      ownerId: "owner-1",
      jobId,
      packageId,
      sizeBytes: 3 * 1024 * 1024,
      stripeCustomerId: "cus_test_1",
      meterEventName: "scorm_mb_processed",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "scorm_mb_processed",
        identifier: packageId,
        payload: { stripe_customer_id: "cus_test_1", value: "3" },
      })
    );

    const [row] = await db.select().from(meteredUsageEvent).where(eq(meteredUsageEvent.packageId, packageId)).limit(1);
    expect(row).toMatchObject({ sizeBytes: 3 * 1024 * 1024, mbBilled: 3, stripeEventId: packageId });
  });

  it("still records the usage event locally when the owner has no Stripe customer id, without calling Stripe", async () => {
    const { jobId, packageId } = await seedJobAndPackage();
    const db = createDb(env.DB);
    const create = vi.fn();
    const stripe = fakeStripe({ create });

    await reportMeteredUsage(stripe, db, {
      ownerType: "user",
      ownerId: "owner-2",
      jobId,
      packageId,
      sizeBytes: 1024,
      stripeCustomerId: null,
      meterEventName: "scorm_mb_processed",
    });

    expect(create).not.toHaveBeenCalled();
    const [row] = await db.select().from(meteredUsageEvent).where(eq(meteredUsageEvent.packageId, packageId)).limit(1);
    expect(row).toMatchObject({ mbBilled: 1, stripeEventId: null });
  });

  it("leaves the local row recorded with a null stripeEventId when the Stripe call fails, and does not throw", async () => {
    const { jobId, packageId } = await seedJobAndPackage();
    const db = createDb(env.DB);
    const create = vi.fn(async () => {
      throw new Error("simulated Stripe outage");
    });
    const stripe = fakeStripe({ create });

    await expect(
      reportMeteredUsage(stripe, db, {
        ownerType: "user",
        ownerId: "owner-3",
        jobId,
        packageId,
        sizeBytes: 2 * 1024 * 1024,
        stripeCustomerId: "cus_test_3",
        meterEventName: "scorm_mb_processed",
      })
    ).resolves.toBeUndefined();

    const [row] = await db.select().from(meteredUsageEvent).where(eq(meteredUsageEvent.packageId, packageId)).limit(1);
    expect(row).toMatchObject({ mbBilled: 2, stripeEventId: null });
  });
});
