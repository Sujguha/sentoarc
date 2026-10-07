import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { usageCounter, meteredUsageEvent, subscription } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier } from "../middleware/require-plan";
import type { AppBindings } from "../types/hono";

export const usageRoute = new Hono<AppBindings>().get(
  "/",
  requireAuth,
  resolvePlanTier,
  async (c) => {
    const user = c.get("user");
    const tier = c.get("planTier");
    const ownerType = c.get("ownerType");
    const ownerId = c.get("ownerId");
    const db = createDb(c.env.DB);

    const [row] = await db
      .select({ value: usageCounter.value })
      .from(usageCounter)
      .where(
        and(
          eq(usageCounter.ownerType, "user"),
          eq(usageCounter.ownerId, user.id),
          eq(usageCounter.metric, "free_uploads_used")
        )
      )
      .limit(1);

    const freeUploadLimit = Number(c.env.FREE_UPLOAD_LIMIT);
    const freeUploadsUsed = row?.value ?? 0;

    let balanceCents: number | null = null;
    let meteredMbBilledLifetime: number | null = null;
    if (tier === "metered") {
      const [sub] = await db
        .select({ balanceCents: subscription.balanceCents })
        .from(subscription)
        .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
        .limit(1);
      balanceCents = sub?.balanceCents ?? 0;

      const [sum] = await db
        .select({ total: sql<number>`coalesce(sum(${meteredUsageEvent.mbBilled}), 0)` })
        .from(meteredUsageEvent)
        .where(and(eq(meteredUsageEvent.ownerType, ownerType), eq(meteredUsageEvent.ownerId, ownerId)));
      meteredMbBilledLifetime = sum?.total ?? 0;
    }

    return c.json({
      tier,
      freeUploadLimit,
      freeUploadsUsed,
      freeUploadsRemaining: Math.max(0, freeUploadLimit - freeUploadsUsed),
      // Prepaid balance remaining, in cents -- the actual gate on
      // whether the next upload will go through.
      balanceCents,
      // Lifetime total processed, informational only.
      meteredMbBilledLifetime,
    });
  }
);
