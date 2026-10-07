import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { subscription, contactSalesLead, featureFlag } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { requireAdmin } from "../middleware/require-admin";
import { computeProcessingStats } from "../lib/stats";
import { setFeatureFlag, deleteFeatureFlag } from "../lib/feature-flags";
import { searchOwners } from "../lib/owner-search";
import type { AppBindings } from "../types/hono";

export const adminRoute = new Hono<AppBindings>();

adminRoute.get("/ping", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

// Platform-wide (no owner filter) processing stats -- same shape as
// the personal GET /api/usage/stats, for the founder to see total
// throughput across every user and org rather than just their own.
adminRoute.get("/stats", requireAuth, requireAdmin, async (c) => {
  const db = createDb(c.env.DB);
  const stats = await computeProcessingStats(db, null, new Date());
  return c.json(stats);
});

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

// Contact-sales leads (POST /api/contact-sales), newest first, with a
// status the founder updates by hand as they work through them -- no
// CRM integration yet, this is the whole workflow.
adminRoute.get("/leads", requireAuth, requireAdmin, async (c) => {
  const db = createDb(c.env.DB);
  const leads = await db.select().from(contactSalesLead).orderBy(desc(contactSalesLead.createdAt));
  return c.json({ leads });
});

adminRoute.put("/leads/:id/status", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: string }>().catch(() => null);
  const status = body?.status;
  if (status !== "new" && status !== "contacted" && status !== "closed") {
    return c.json({ error: "invalid_status", allowed: ["new", "contacted", "closed"] }, 400);
  }

  const db = createDb(c.env.DB);
  const result = await db.update(contactSalesLead).set({ status }).where(eq(contactSalesLead.id, id)).returning({ id: contactSalesLead.id });
  if (result.length === 0) {
    return c.json({ error: "lead_not_found" }, 404);
  }
  return c.json({ ok: true, status });
});

// Looks up candidate owners by email (user) or name (org) so the
// founder can find the ownerType/ownerId the tier/retention PUT routes
// above need without already knowing it -- those routes existed first
// but had no way to discover their own path parameters from the UI.
adminRoute.get("/owners/search", requireAuth, requireAdmin, async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) {
    return c.json({ owners: [] });
  }

  const db = createDb(c.env.DB);
  const owners = await searchOwners(db, q);
  return c.json({ owners });
});

// Generic rollout/kill-switch flags -- nothing reads one yet (see
// src/lib/feature-flags.ts), this is just the plumbing to toggle one
// without a deploy the moment a feature needs gating.
adminRoute.get("/feature-flags", requireAuth, requireAdmin, async (c) => {
  const db = createDb(c.env.DB);
  const flags = await db.select().from(featureFlag).orderBy(featureFlag.key);
  return c.json({ flags });
});

adminRoute.put("/feature-flags/:key", requireAuth, requireAdmin, async (c) => {
  const key = c.req.param("key");
  if (!/^[a-z0-9_-]+$/.test(key)) {
    return c.json(
      { error: "invalid_key", message: "Keys may only contain lowercase letters, digits, underscores, and hyphens." },
      400
    );
  }

  const body = await c.req.json<{ enabled?: boolean; description?: string | null }>().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return c.json({ error: "enabled_required" }, 400);
  }

  const db = createDb(c.env.DB);
  await setFeatureFlag(db, key, body.enabled, body.description);
  return c.json({ ok: true, key, enabled: body.enabled });
});

adminRoute.delete("/feature-flags/:key", requireAuth, requireAdmin, async (c) => {
  const key = c.req.param("key");
  const db = createDb(c.env.DB);
  await deleteFeatureFlag(db, key);
  return c.json({ ok: true });
});
