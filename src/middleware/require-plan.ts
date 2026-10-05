import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { createDb } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import type { AppBindings, HonoVariables } from "../types/hono";

// Resolves the caller's plan tier server-side from D1 — never from a
// client-sent value — and stores it on the context for downstream limit
// checks. Must run after requireAuth.
export const resolvePlanTier = createMiddleware<AppBindings>(async (c, next) => {
  const db = createDb(c.env.DB);
  const user = c.get("user");

  const [row] = await db
    .select({ tier: subscription.tier, status: subscription.status })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, user.id)))
    .limit(1);

  const isActive = row && ["active", "trialing", "past_due"].includes(row.status);
  c.set("planTier", isActive ? (row.tier as HonoVariables["planTier"]) : "free");

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
