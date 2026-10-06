import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMiddleware } from "hono/factory";
import { createDb } from "../src/lib/db/client";
import { subscription, organization, member, user as userTable } from "../src/lib/db/schema";
import { resolvePlanTier, resolvePlanTierFor, requirePlan } from "../src/middleware/require-plan";
import type { AppBindings } from "../src/types/hono";

async function seedSubscription(
  ownerType: "user" | "org",
  ownerId: string,
  tier: "free" | "pro" | "enterprise" | "metered",
  opts: { status?: string; retentionDaysOverride?: number | null; stripeCustomerId?: string | null } = {}
) {
  const db = createDb(env.DB);
  const now = new Date();
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType,
    ownerId,
    tier,
    status: opts.status ?? "active",
    retentionDaysOverride: opts.retentionDaysOverride ?? null,
    stripeCustomerId: opts.stripeCustomerId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedOrgWithMember(userId: string, role: "admin" | "editor" | "viewer"): Promise<string> {
  const db = createDb(env.DB);
  const now = new Date();
  const orgId = crypto.randomUUID();
  await db.insert(organization).values({ id: orgId, name: "Test Org", createdAt: now });
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: orgId, userId, role, createdAt: now });
  return orgId;
}

async function seedUser(): Promise<string> {
  const db = createDb(env.DB);
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(userTable).values({ id, name: "Test", email: `${id}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  return id;
}

// Mirrors how the real routes chain requireAuth -> resolvePlanTier ->
// requirePlan, but with a fake "requireAuth" that sets a fixed user —
// better-auth sign-up/sign-in needs a real SendGrid call, which these
// gating tests have no reason to depend on. requirePlan/resolvePlanTier
// themselves are the real production middleware.
function appWithFakeUser(
  userId: string,
  allowed: Array<"free" | "pro" | "enterprise" | "metered">,
  activeOrganizationId: string | null = null
) {
  const fakeAuth = createMiddleware<AppBindings>(async (c, next) => {
    c.set("user", { id: userId, email: "test@example.com", name: "Test" });
    c.set("activeOrganizationId", activeOrganizationId);
    await next();
  });
  return new Hono<AppBindings>().get("/gated", fakeAuth, resolvePlanTier, requirePlan(allowed), (c) =>
    c.json({ ownerType: c.get("ownerType"), ownerId: c.get("ownerId"), orgRole: c.get("orgRole") })
  );
}

describe("resolvePlanTierFor", () => {
  it("returns free when there is no subscription row", async () => {
    const db = createDb(env.DB);
    const result = await resolvePlanTierFor(db, "user", crypto.randomUUID());
    expect(result.tier).toBe("free");
    expect(result.retentionDaysOverride).toBeNull();
  });

  it("returns the stored tier for an active subscription", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "pro");
    const db = createDb(env.DB);
    expect((await resolvePlanTierFor(db, "user", ownerId)).tier).toBe("pro");
  });

  it("falls back to free for a canceled subscription, regardless of its stored tier", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "pro", { status: "canceled" });
    const db = createDb(env.DB);
    expect((await resolvePlanTierFor(db, "user", ownerId)).tier).toBe("free");
  });

  it("treats past_due as still active", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "pro", { status: "past_due" });
    const db = createDb(env.DB);
    expect((await resolvePlanTierFor(db, "user", ownerId)).tier).toBe("pro");
  });

  it("surfaces a founder-set retention override", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("org", ownerId, "enterprise", { retentionDaysOverride: 90 });
    const db = createDb(env.DB);
    const result = await resolvePlanTierFor(db, "org", ownerId);
    expect(result.tier).toBe("enterprise");
    expect(result.retentionDaysOverride).toBe(90);
  });

  it("ignores a retention override on a canceled subscription", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("org", ownerId, "enterprise", { status: "canceled", retentionDaysOverride: 90 });
    const db = createDb(env.DB);
    const result = await resolvePlanTierFor(db, "org", ownerId);
    expect(result.retentionDaysOverride).toBeNull();
  });

  it("returns the metered tier and the owner's Stripe customer id", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "metered", { stripeCustomerId: "cus_test_abc" });
    const db = createDb(env.DB);
    const result = await resolvePlanTierFor(db, "user", ownerId);
    expect(result.tier).toBe("metered");
    expect(result.stripeCustomerId).toBe("cus_test_abc");
  });

  it("ignores a Stripe customer id on a canceled subscription", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "metered", { status: "canceled", stripeCustomerId: "cus_test_abc" });
    const db = createDb(env.DB);
    const result = await resolvePlanTierFor(db, "user", ownerId);
    expect(result.stripeCustomerId).toBeNull();
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
    await seedSubscription("user", ownerId, "pro");
    const app = appWithFakeUser(ownerId, ["pro", "enterprise"]);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
  });

  it("allows a metered-tier caller through a route gated to pro/enterprise/metered", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "metered");
    const app = appWithFakeUser(ownerId, ["pro", "enterprise", "metered"]);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
  });

  it("blocks a metered-tier caller from a route not gated to include metered", async () => {
    const ownerId = crypto.randomUUID();
    await seedSubscription("user", ownerId, "metered");
    const app = appWithFakeUser(ownerId, ["pro", "enterprise"]);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(403);
  });
});

describe("resolvePlanTier: active-org context", () => {
  it("acts as the org (not the user) when the caller has an active org and is still a member", async () => {
    const userId = await seedUser();
    const orgId = await seedOrgWithMember(userId, "editor");
    await seedSubscription("org", orgId, "enterprise");

    const app = appWithFakeUser(userId, ["free", "pro", "enterprise"], orgId);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerType: string; ownerId: string; orgRole: string };
    expect(body.ownerType).toBe("org");
    expect(body.ownerId).toBe(orgId);
    expect(body.orgRole).toBe("editor");
  });

  it("falls back to personal context when the active org no longer has this user as a member", async () => {
    const userId = await seedUser();
    const staleOrgId = crypto.randomUUID(); // never actually joined (or since removed)

    const app = appWithFakeUser(userId, ["free", "pro", "enterprise"], staleOrgId);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ownerType: string; ownerId: string; orgRole: string | null };
    expect(body.ownerType).toBe("user");
    expect(body.ownerId).toBe(userId);
    expect(body.orgRole).toBeNull();
  });

  it("uses the org's own plan tier, independent of the user's personal tier", async () => {
    const userId = await seedUser();
    await seedSubscription("user", userId, "free");
    const orgId = await seedOrgWithMember(userId, "admin");
    await seedSubscription("org", orgId, "enterprise");

    // Gated to enterprise only -- would 403 if it resolved the user's
    // personal (free) tier instead of the org's.
    const app = appWithFakeUser(userId, ["enterprise"], orgId);
    const res = await app.request("/gated", {}, env);
    expect(res.status).toBe(200);
  });
});
