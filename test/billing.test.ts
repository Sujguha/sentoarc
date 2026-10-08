import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/client";
import { subscription, packPurchase } from "../src/lib/db/schema";
import { listPurchases } from "../src/routes/billing";
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

function checkoutCompletedEvent(opts: {
  eventId: string;
  sessionId: string;
  ownerId: string;
  customerId: string;
  amountTotal: number;
  packTier?: string;
}) {
  return JSON.stringify({
    id: opts.eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId,
        object: "checkout.session",
        mode: "payment",
        client_reference_id: opts.ownerId,
        customer: opts.customerId,
        amount_total: opts.amountTotal,
        metadata: opts.packTier ? { packTier: opts.packTier } : {},
      },
    },
  });
}

describe("POST /api/billing/webhook", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      body: checkoutCompletedEvent({
        eventId: "evt_1",
        sessionId: "cs_1",
        ownerId: "owner-1",
        customerId: "cus_1",
        amountTotal: 49900,
        packTier: "project_pack",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a badly-signed payload", async () => {
    const payload = checkoutCompletedEvent({
      eventId: "evt_2",
      sessionId: "cs_2",
      ownerId: "owner-2",
      customerId: "cus_2",
      amountTotal: 49900,
      packTier: "project_pack",
    });
    const badSignature = await signStripePayload(payload, "whsec_wrong_secret");
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": badSignature },
      body: payload,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "signature_verification_failed" });
  });

  it("grants a fresh Project Pack purchase: tier, objects, and a ledger row", async () => {
    const payload = checkoutCompletedEvent({
      eventId: "evt_pack_1",
      sessionId: "cs_pack_1",
      ownerId: "test-user-pack-1",
      customerId: "cus_pack_1",
      amountTotal: 49900,
      packTier: "project_pack",
    });
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [row] = await db.select().from(subscription).where(eq(subscription.stripeCustomerId, "cus_pack_1")).limit(1);
    expect(row).toMatchObject({ ownerId: "test-user-pack-1", tier: "project_pack", objectsRemaining: 100, status: "active" });

    const [purchase] = await db.select().from(packPurchase).where(eq(packPurchase.stripeCheckoutSessionId, "cs_pack_1")).limit(1);
    expect(purchase).toMatchObject({ packTier: "project_pack", objectsGranted: 100, amountCents: 49900 });
  });

  it("grants Enterprise Migration as unlimited (tier set, objectsRemaining untouched)", async () => {
    const payload = checkoutCompletedEvent({
      eventId: "evt_ent_1",
      sessionId: "cs_ent_1",
      ownerId: "test-user-ent-1",
      customerId: "cus_ent_1",
      amountTotal: 199900,
      packTier: "enterprise",
    });
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [row] = await db.select().from(subscription).where(eq(subscription.stripeCustomerId, "cus_ent_1")).limit(1);
    expect(row?.tier).toBe("enterprise");

    const [purchase] = await db.select().from(packPurchase).where(eq(packPurchase.stripeCheckoutSessionId, "cs_ent_1")).limit(1);
    expect(purchase).toMatchObject({ packTier: "enterprise", objectsGranted: null, amountCents: 199900 });
  });

  it("stacks a second Project Pack purchase onto the existing objectsRemaining", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: "test-user-pack-2",
      stripeCustomerId: "cus_pack_2",
      tier: "project_pack",
      status: "active",
      objectsRemaining: 30,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    const payload = checkoutCompletedEvent({
      eventId: "evt_pack_2",
      sessionId: "cs_pack_2",
      ownerId: "test-user-pack-2",
      customerId: "cus_pack_2",
      amountTotal: 49900,
      packTier: "project_pack",
    });
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(subscription).where(eq(subscription.stripeCustomerId, "cus_pack_2")).limit(1);
    expect(row?.objectsRemaining).toBe(130);
  });

  it("never downgrades an existing Enterprise owner who (re-)buys a Project Pack", async () => {
    const db = createDb(env.DB);
    const now = new Date();
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: "test-user-ent-2",
      stripeCustomerId: "cus_ent_2",
      tier: "enterprise",
      status: "active",
      objectsRemaining: 0,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    const payload = checkoutCompletedEvent({
      eventId: "evt_ent_2",
      sessionId: "cs_ent_2",
      ownerId: "test-user-ent-2",
      customerId: "cus_ent_2",
      amountTotal: 49900,
      packTier: "project_pack",
    });
    const signature = await signStripePayload(payload, WEBHOOK_SECRET);
    await SELF.fetch("https://example.com/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });

    const [row] = await db.select().from(subscription).where(eq(subscription.stripeCustomerId, "cus_ent_2")).limit(1);
    expect(row?.tier).toBe("enterprise");
  });

  it("is idempotent against a redelivered webhook for the same checkout session", async () => {
    const payload = checkoutCompletedEvent({
      eventId: "evt_pack_3",
      sessionId: "cs_pack_3",
      ownerId: "test-user-pack-3",
      customerId: "cus_pack_3",
      amountTotal: 49900,
      packTier: "project_pack",
    });

    for (let i = 0; i < 2; i++) {
      const signature = await signStripePayload(payload, WEBHOOK_SECRET);
      const res = await SELF.fetch("https://example.com/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: payload,
      });
      expect(res.status).toBe(200);
    }

    const db = createDb(env.DB);
    const [row] = await db.select().from(subscription).where(eq(subscription.stripeCustomerId, "cus_pack_3")).limit(1);
    // Granted once, not twice -- the second delivery must be a no-op.
    expect(row?.objectsRemaining).toBe(100);

    const purchases = await db.select().from(packPurchase).where(eq(packPurchase.stripeCheckoutSessionId, "cs_pack_3"));
    expect(purchases).toHaveLength(1);
  });
});

describe("POST /api/billing/checkout-pack", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/checkout-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packTier: "project_pack" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("listPurchases", () => {
  it("returns only this owner's purchases, newest first", async () => {
    const db = createDb(env.DB);
    const ownerId = "test-user-list-1";
    const otherOwnerId = "test-user-list-2";
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();

    await db.insert(packPurchase).values([
      {
        id: crypto.randomUUID(),
        ownerType: "user",
        ownerId,
        packTier: "project_pack",
        objectsGranted: 100,
        amountCents: 49900,
        stripeCheckoutSessionId: "cs_list_older",
        createdAt: older,
      },
      {
        id: crypto.randomUUID(),
        ownerType: "user",
        ownerId,
        packTier: "enterprise",
        objectsGranted: null,
        amountCents: 199900,
        stripeCheckoutSessionId: "cs_list_newer",
        createdAt: newer,
      },
      {
        id: crypto.randomUUID(),
        ownerType: "user",
        ownerId: otherOwnerId,
        packTier: "project_pack",
        objectsGranted: 100,
        amountCents: 49900,
        stripeCheckoutSessionId: "cs_list_other_owner",
        createdAt: newer,
      },
    ]);

    const result = await listPurchases(db, ownerId);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ packTier: "enterprise", objectsGranted: null, amountCents: 199900 });
    expect(result[1]).toMatchObject({ packTier: "project_pack", objectsGranted: 100, amountCents: 49900 });
  });

  it("returns an empty list for an owner with no purchases", async () => {
    const db = createDb(env.DB);
    const result = await listPurchases(db, crypto.randomUUID());
    expect(result).toEqual([]);
  });
});

describe("GET /api/billing/purchases", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch("https://example.com/api/billing/purchases");
    expect(res.status).toBe(401);
  });
});
