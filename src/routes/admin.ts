import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { requireAdmin } from "../middleware/require-admin";
import type { AppBindings } from "../types/hono";

export const adminRoute = new Hono<AppBindings>();

adminRoute.get("/ping", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

// Enterprise is sales-assisted, not self-serve -- a custom retention
// window is something the founder sets per customer after a contract
// conversation, not something an org configures itself. ownerType/
// ownerId identify the subscription row the same way it's created
// (see billing.ts) -- "user" for an individual, "org" for an
// organization account.
adminRoute.put("/subscriptions/:ownerType/:ownerId/retention", requireAuth, requireAdmin, async (c) => {
  const ownerType = c.req.param("ownerType");
  const ownerId = c.req.param("ownerId");
  if (ownerType !== "user" && ownerType !== "org") {
    return c.json({ error: "invalid_owner_type" }, 400);
  }

  const body = await c.req.json<{ retentionDays?: number | null }>().catch(() => null);
  const retentionDays = body?.retentionDays;
  if (retentionDays === undefined) {
    return c.json({ error: "retention_days_required" }, 400);
  }
  if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays < 0)) {
    return c.json(
      { error: "invalid_retention_days", message: "retentionDays must be a non-negative integer or null to clear the override." },
      400
    );
  }

  const db = createDb(c.env.DB);
  const result = await db
    .update(subscription)
    .set({ retentionDaysOverride: retentionDays, updatedAt: new Date() })
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .returning({ id: subscription.id });

  if (result.length === 0) {
    return c.json({ error: "subscription_not_found" }, 404);
  }

  return c.json({ ok: true, retentionDays });
});

// Sets (creating the row if none exists yet) an owner's plan tier. This
// is the only way an org's subscription row ever comes into being --
// Stripe checkout (billing.ts) only ever creates a "user"-owned one, so
// an org provisioned via the founder-only organization-creation gate
// (see allowUserToCreateOrganization in auth/index.ts) would otherwise
// be stuck on the implicit "free" fallback (resolvePlanTierFor) forever.
// The founder calls this after a sales conversation, same spirit as the
// retention override above; also handy for comping a Pro/metered plan.
adminRoute.put("/subscriptions/:ownerType/:ownerId/tier", requireAuth, requireAdmin, async (c) => {
  const ownerType = c.req.param("ownerType");
  const ownerId = c.req.param("ownerId");
  if (ownerType !== "user" && ownerType !== "org") {
    return c.json({ error: "invalid_owner_type" }, 400);
  }

  const body = await c.req.json<{ tier?: string }>().catch(() => null);
  const tier = body?.tier;
  if (tier !== "free" && tier !== "pro" && tier !== "enterprise" && tier !== "metered") {
    return c.json({ error: "invalid_tier", allowed: ["free", "pro", "enterprise", "metered"] }, 400);
  }

  const db = createDb(c.env.DB);
  const now = new Date();
  const [existing] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .limit(1);

  if (existing) {
    await db.update(subscription).set({ tier, status: "active", updatedAt: now }).where(eq(subscription.id, existing.id));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType,
      ownerId,
      tier,
      status: "active",
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  return c.json({ ok: true, tier });
});
