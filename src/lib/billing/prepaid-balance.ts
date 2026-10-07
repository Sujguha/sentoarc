import { and, eq, sql } from "drizzle-orm";
import { meteredUsageEvent, subscription } from "../db/schema";
import type { Db } from "../db/client";

const BYTES_PER_MB = 1024 * 1024;

// Bills in whole units (1 unit = 1 MB); a file under 1MB still costs us
// R2 + CPU to process, so round up rather than let it cost nothing.
export function computeMbBilled(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / BYTES_PER_MB));
}

export interface ChargeParams {
  ownerType: "user" | "org";
  ownerId: string;
  jobId: string;
  packageId: string;
  sizeBytes: number;
  unitPriceCents: number;
}

export interface ChargeResult {
  ok: boolean;
  mbBilled: number;
  costCents: number;
  // The resulting balance on success, or the current (insufficient)
  // balance on failure -- either way, what the caller should show next.
  balanceCents: number;
}

// Atomically deducts the cost of one upload from the owner's prepaid
// balance and records a local audit-trail row on success. This is the
// entire point of prepaid billing: the money is already in the account
// before any service is delivered, so there's never a "we processed it
// but couldn't collect" outcome the way a postpaid subscription risks
// if a card fails at the end of the billing period.
//
// The deduction is a single conditional UPDATE (balance_cents >= cost
// in the WHERE clause, same pattern as the free-tier upload counter in
// uploads.ts) so two uploads landing concurrently can never both
// succeed against a balance that can only actually cover one of them.
export async function chargeForUpload(db: Db, params: ChargeParams): Promise<ChargeResult> {
  const mbBilled = computeMbBilled(params.sizeBytes);
  const costCents = mbBilled * params.unitPriceCents;
  const now = new Date();

  const updated = await db
    .update(subscription)
    .set({ balanceCents: sql`${subscription.balanceCents} - ${costCents}`, updatedAt: now })
    .where(
      and(
        eq(subscription.ownerType, params.ownerType),
        eq(subscription.ownerId, params.ownerId),
        sql`${subscription.balanceCents} >= ${costCents}`
      )
    )
    .returning({ balanceCents: subscription.balanceCents });

  if (updated.length === 0) {
    const [current] = await db
      .select({ balanceCents: subscription.balanceCents })
      .from(subscription)
      .where(and(eq(subscription.ownerType, params.ownerType), eq(subscription.ownerId, params.ownerId)))
      .limit(1);
    return { ok: false, mbBilled, costCents, balanceCents: current?.balanceCents ?? 0 };
  }

  await db.insert(meteredUsageEvent).values({
    id: crypto.randomUUID(),
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    jobId: params.jobId,
    packageId: params.packageId,
    sizeBytes: params.sizeBytes,
    mbBilled,
    // No Stripe event to report anymore -- this row is purely a local
    // ledger of what was charged and when.
    stripeEventId: null,
    createdAt: now,
  });

  return { ok: true, mbBilled, costCents, balanceCents: updated[0]?.balanceCents ?? 0 };
}
