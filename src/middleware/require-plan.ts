import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { createDb, type Db } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import type { AppBindings, HonoVariables } from "../types/hono";

type PlanTier = HonoVariables["planTier"];

// Shared by the request-time middleware below and the queue consumer
// (which has no Hono context to resolve tier from) — resolves a plan
// tier server-side from D1, never from a client-sent value.
export async function resolvePlanTierFor(db: Db, ownerType: "user" | "org", ownerId: string): Promise<PlanTier> {
  const [row] = await db
    .select({ tier: subscription.tier, status: subscription.status })
    .from(subscription)
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .limit(1);

  const isActive = row && ["active", "trialing", "past_due"].includes(row.status);
  return isActive ? (row.tier as PlanTier) : "free";
}

// Resolves the caller's plan tier server-side from D1 — never from a
// client-sent value — and stores it on the context for downstream limit
// checks. Must run after requireAuth.
export const resolvePlanTier = createMiddleware<AppBindings>(async (c, next) => {
  const db = createDb(c.env.DB);
  const user = c.get("user");
  c.set("planTier", await resolvePlanTierFor(db, "user", user.id));
  await next();
});

export function requirePlan(allowed: Array<"free" | "pro" | "enterprise">) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const tier = c.get("planTier");
    if (!allowed.includes(tier)) {
      return c.json({ error: "plan_upgrade_required", requiredPlans: allowed }, 403);
    }
    await next();
  });
}
