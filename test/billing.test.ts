import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/client";
import { subscription } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const WEBHOOK_SECRET = "not-a-real-secret--vitest-placeholder";

async function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

function subscriptionUpdatedEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: { data: [{ price: { id: "price_test_monthly" }, quantity: 1 }] },
        ...overrides,
      },
    },
  });
}

describe("POST /api/billing/webhook", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      body: subscriptionUpdatedEvent(),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a badly-signed payload", async () => {
    const payload = subscriptionUpdatedEvent();
    const badSignature = await signStripePayload(payload, "whsec_wrong_secret");
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": badSignature },
      body: payload,
    });
    expect(res.status).toBe(400);
    expect((await res.json())).toMatchObject({ error: "signature_verification_failed" });
  });

  it("syncs an existing subscription row on a correctly-signed customer.subscription.updated event", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: "test-user-1",
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_old",
      stripePriceId: null,
      tier: "free",
      status: "incomplete",
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    const payload = subscriptionUpdatedEvent();
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.stripeCustomerId, "cus_test_1"))
      .limit(1);
    expect(row?.tier).toBe("pro");
    expect(row?.status).toBe("active");
    expect(row?.stripeSubscriptionId).toBe("sub_test_1");
  });

  it("downgrades to free when the subscription is cancelled", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: "test-user-2",
      stripeCustomerId: "cus_test_2",
      stripeSubscriptionId: "sub_test_2",
      stripePriceId: "price_test_monthly",
      tier: "pro",
      status: "active",
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    const payload = JSON.stringify({
      id: "evt_test_2",
      object: "event",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test_2",
          object: "subscription",
          customer: "cus_test_2",
          status: "canceled",
          current_period_end: Math.floor(Date.now() / 1000),
          items: { data: [{ price: { id: "price_test_monthly" }, quantity: 1 }] },
        },
      },
    });
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.stripeCustomerId, "cus_test_2"))
      .limit(1);
    expect(row?.tier).toBe("free");
    expect(row?.status).toBe("canceled");
  });
});

describe("POST /api/billing/checkout", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval: "month" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/billing/portal", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/portal", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
