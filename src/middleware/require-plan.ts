import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { createDb, type Db } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import { getMemberRole } from "../lib/org-membership";
import type { AppBindings, HonoVariables } from "../types/hono";

type PlanTier = HonoVariables["planTier"];

export interface SubscriptionContext {
  tier: PlanTier;
  retentionDaysOverride: number | null;
  stripeCustomerId: string | null;
}

// Shared by the request-time middleware below and the queue consumer
// (which has no Hono context to resolve tier from) — resolves plan/
// retention state server-side from D1, never from a client-sent value.
export async function resolvePlanTierFor(db: Db, ownerType: "user" | "org", ownerId: string): Promise<SubscriptionContext> {
  const [row] = await db
    .select({
      tier: subscription.tier,
      status: subscription.status,
      retentionDaysOverride: subscription.retentionDaysOverride,
      stripeCustomerId: subscription.stripeCustomerId,
    })
    .from(subscription)
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .limit(1);

  const isActive = row && ["active", "trialing", "past_due"].includes(row.status);
  return {
    tier: isActive ? (row.tier as PlanTier) : "free",
    retentionDaysOverride: isActive ? (row.retentionDaysOverride ?? null) : null,
    stripeCustomerId: isActive ? (row.stripeCustomerId ?? null) : null,
  };
}

// Resolves who the request is actually acting as (the user's currently
// active org, if they're still a verified member of it — re-checked on
// every request, never trusted from the stale session alone — or the
// user themself) and their plan tier in that context. Never from a
// client-sent value. Must run after requireAuth.
export const resolvePlanTier = createMiddleware<AppBindings>(async (c, next) => {
  const db = createDb(c.env.DB);
  const user = c.get("user");
  const activeOrganizationId = c.get("activeOrganizationId");

  const orgRole = activeOrganizationId ? await getMemberRole(db, activeOrganizationId, user.id) : null;

  const ownerType: "user" | "org" = orgRole ? "org" : "user";
  const ownerId = orgRole && activeOrganizationId ? activeOrganizationId : user.id;

  const sub = await resolvePlanTierFor(db, ownerType, ownerId);

  c.set("ownerType", ownerType);
  c.set("ownerId", ownerId);
  c.set("orgRole", orgRole);
  c.set("planTier", sub.tier);
  c.set("retentionDaysOverride", sub.retentionDaysOverride);
  c.set("stripeCustomerId", sub.stripeCustomerId);
  await next();
});

export function requirePlan(allowed: Array<"free" | "project_pack" | "enterprise">) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const tier = c.get("planTier");
    if (!allowed.includes(tier)) {
      return c.json({ error: "plan_upgrade_required", requiredPlans: allowed }, 403);
    }
    await next();
  });
}
