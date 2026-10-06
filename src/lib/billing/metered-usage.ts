import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { meteredUsageEvent } from "../db/schema";
import type { Db } from "../db/client";

const BYTES_PER_MB = 1024 * 1024;

// Stripe's meter bills in whole units (1 unit = 1 MB here); a file under
// 1MB still costs us R2 + CPU to process, so round up rather than let it
// bill as zero.
export function computeMbBilled(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / BYTES_PER_MB));
}

export interface MeteredUsageParams {
  ownerType: "user" | "org";
  ownerId: string;
  jobId: string;
  packageId: string;
  sizeBytes: number;
  stripeCustomerId: string | null;
  meterEventName: string;
}

// Records a billable upload on the pay-as-you-go tier. The local D1 row
// is written unconditionally first -- it's the audit trail finance
// reconciles against -- then reporting to Stripe is attempted. A Stripe
// outage, a missing customer id, or any other failure here must never
// block the user's upload pipeline, so errors are logged and the row is
// simply left with stripeEventId = null for later reconciliation rather
// than thrown.
export async function reportMeteredUsage(stripe: Stripe, db: Db, params: MeteredUsageParams): Promise<void> {
  const mbBilled = computeMbBilled(params.sizeBytes);
  const id = crypto.randomUUID();

  await db.insert(meteredUsageEvent).values({
    id,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    jobId: params.jobId,
    packageId: params.packageId,
    sizeBytes: params.sizeBytes,
    mbBilled,
    stripeEventId: null,
    createdAt: new Date(),
  });

  if (!params.stripeCustomerId) {
    console.error(`Metered usage for package ${params.packageId} not reported: owner has no Stripe customer id`);
    return;
  }

  try {
    const event = await stripe.billing.meterEvents.create({
      event_name: params.meterEventName,
      payload: { stripe_customer_id: params.stripeCustomerId, value: String(mbBilled) },
      // The package id is already a one-time-use identifier for this
      // upload, so reusing it as the meter event's idempotency key means
      // a retried request can never double-bill the same upload.
      identifier: params.packageId,
    });
    await db.update(meteredUsageEvent).set({ stripeEventId: event.identifier }).where(eq(meteredUsageEvent.id, id));
  } catch (err) {
    console.error(`Failed to report metered usage to Stripe for package ${params.packageId}`, err);
  }
}
