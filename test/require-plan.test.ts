import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMiddleware } from "hono/factory";
import { createDb } from "../src/lib/db/client";
import { subscription } from "../src/lib/db/schema";
import { resolvePlanTier, resolvePlanTierFor, requirePlan } from "../src/middleware/require-plan";
import type { AppBindings } from "../src/types/hono";

async function seedSubscription(ownerId: string, tier: "free" | "pro" | "enterprise", status = "active") {
  const db = createDb(env.DB);
  const now = new Date();
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType: "user",
    ownerId,
    tier,
    status,
    createdAt: now,
    updatedAt: now,
  });
}

// Mirrors how the real routes chain requireAuth -> resolvePlanTier ->
// requirePlan, but with a fake "requireAuth" that sets a fixed user —
// better-auth sign-up/sign-in needs a real SendGrid call, which these
// gating tests have no reason to depend on. requirePlan/resolvePlanTier
// themselves are the real production middleware.
function appWithFakeUser(userId: string, allowed: Array<"free" | "pro" | "enterprise">) {
  const fakeAuth = createMiddleware<AppBindings>(async (c, next) => {
    c.set("user", { id: userId, email: "test@example.com", name: "Test" });
    await next();
  });
  return new Hono<AppBindings>().get("/gated", fakeAuth, resolvePlanTier, requirePlan(allowed), (c) =>
    c.json({ ok: true })
  );
}

describe("resolvePlanTierFor", () => {
  it("returns free when there is no subscription row", async () => {
    const db = createDb(env.DB);
    const tier = await resolvePlanTierFor(db, "user", crypto.randomUUID());
    expect(tier).toBe("free");
  });

  it("returns the stored tier for an active subscription", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription(ownerId, "pro");
    const db = createDb(env.DB);
    expect(await resolvePlanTierFor(db, "user", ownerId)).toBe("pro");
  });

  it("falls back to free for a canceled subscription, regardless of its stored tier", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription(ownerId, "pro", "canceled");
    const db = createDb(env.DB);
    expect(await resolvePlanTierFor(db, "user", ownerId)).toBe("free");
  });

  it("treats past_due as still active", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription(ownerId, "pro", "past_due");
    const db = createDb(env.DB);
    expect(await resolvePlanTierFor(db, "user", ownerId)).toBe("pro");
  });
});

describe("requirePlan", () => {
  it("blocks a free-tier caller from a Pro-gated route", async () => {
    const ownerId = crypto.randomUUID();
    const app = appWithFakeUser(ownerId, ["pro", "enterprise"]);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "plan_upgrade_required" });
  });

  it("allows a pro-tier caller through the same route", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription(ownerId, "pro");
    const app = appWithFakeUser(ownerId, ["pro", "enterprise"]);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
  });
});
