import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import type Stripe from "stripe";
import { createDb } from "../lib/db/client";
import { subscription, packPurchase } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { createStripeClient, createStripeCryptoProvider } from "../lib/billing/stripe-client";
import type { AppBindings } from "../types/hono";
import type { Env } from "../types/env";

export const billingRoute = new Hono<AppBindings>();

// Purchase history for the Account page's billing section -- the
// packPurchase ledger is also what makes webhook delivery idempotent
// (see grantPackPurchase), so this doubles as a way for a customer (or
// us, debugging a report of "I paid but don't see it") to tell at a
// glance whether a payment actually got credited: if it went through on
// Stripe's side but isn't here, the webhook never ran.
export async function listPurchases(db: ReturnType<typeof createDb>, ownerId: string) {
  return db
    .select({
      id: packPurchase.id,
      packTier: packPurchase.packTier,
      objectsGranted: packPurchase.objectsGranted,
      amountCents: packPurchase.amountCents,
      createdAt: packPurchase.createdAt,
    })
    .from(packPurchase)
    .where(and(eq(packPurchase.ownerType, "user"), eq(packPurchase.ownerId, ownerId)))
    .orderBy(desc(packPurchase.createdAt));
}

billingRoute.get("/purchases", requireAuth, async (c) => {
  const user = c.get("user");
  const db = createDb(c.env.DB);
  const purchases = await listPurchases(db, user.id);
  return c.json({ purchases });
});

type PackTier = "project_pack" | "enterprise";

function packPriceCents(packTier: PackTier, env: Env): number {
  return Number(packTier === "project_pack" ? env.PROJECT_PACK_PRICE_CENTS : env.ENTERPRISE_PACK_PRICE_CENTS);
}

// null means unlimited (Enterprise Migration).
function packObjectsGranted(packTier: PackTier, env: Env): number | null {
  return packTier === "project_pack" ? Number(env.PROJECT_PACK_OBJECTS) : null;
}

function packProductName(packTier: PackTier): string {
  return packTier === "project_pack" ? "SENtoArc Project Pack (100 objects)" : "SENtoArc Enterprise Migration (unlimited objects)";
}

// Buys a one-time pack (Project Pack or Enterprise Migration) via Stripe
// Checkout (mode: "payment", not "subscription" -- there is no recurring
// billing left in this app). The amount is built as inline price_data
// rather than a pre-created Stripe Price: both packs have a fixed price,
// but creating real Price objects ahead of time needs either the Stripe
// Dashboard or a one-off setup script, and price_data is exactly as
// correct for a fixed amount as it was for the old pay-as-you-go top-up's
// customer-chosen one.
billingRoute.post("/checkout-pack", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ packTier?: string }>().catch(() => null);
  const packTier = body?.packTier;
  if (packTier !== "project_pack" && packTier !== "enterprise") {
    return c.json({ error: "invalid_pack_tier", allowed: ["project_pack", "enterprise"] }, 400);
  }

  const db = createDb(c.env.DB);
  const [existing] = await db
    .select({ stripeCustomerId: subscription.stripeCustomerId })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, user.id)))
    .limit(1);

  const stripe = createStripeClient(c.env);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "eur",
          unit_amount: packPriceCents(packTier, c.env),
          product_data: { name: packProductName(packTier) },
        },
        quantity: 1,
      },
    ],
    client_reference_id: user.id,
    // Carries which pack this was through to the webhook -- the webhook
    // never trusts anything client-sent, but it does trust its own
    // signed-and-verified copy of what this route itself told Stripe to
    // charge for.
    metadata: { packTier },
    ...(existing?.stripeCustomerId ? { customer: existing.stripeCustomerId } : { customer_email: user.email }),
    success_url: `${c.env.APP_BASE_URL}/account?checkout=success`,
    cancel_url: `${c.env.APP_BASE_URL}/account?checkout=cancelled`,
  });

  if (!session.url) {
    return c.json({ error: "checkout_session_failed" }, 502);
  }
  return c.json({ url: session.url });
});

// Stripe webhook: the source of truth for what was actually paid for.
// Never trust client-reported pack tier or amount -- only this handler,
// driven by Stripe's own signed events, grants objects.
billingRoute.post("/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "missing_signature" }, 400);
  }

  const payload = await c.req.text();
  const stripe = createStripeClient(c.env);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      createStripeCryptoProvider()
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid signature";
    return c.json({ error: "signature_verification_failed", message: msg }, 400);
  }

  const db = createDb(c.env.DB);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const ownerId = session.client_reference_id;
    const packTier = session.metadata?.packTier;

    if (
      ownerId &&
      typeof session.customer === "string" &&
      session.mode === "payment" &&
      (packTier === "project_pack" || packTier === "enterprise")
    ) {
      await grantPackPurchase(db, {
        ownerId,
        stripeCustomerId: session.customer,
        packTier,
        objectsGranted: packObjectsGranted(packTier, c.env),
        amountCents: session.amount_total ?? 0,
        stripeCheckoutSessionId: session.id,
      });
    }
  }

  return c.json({ received: true });
});

// Credits a completed pack purchase. Idempotent against webhook
// redelivery: the ledger insert's unique stripeCheckoutSessionId is what
// actually prevents a retried event from granting the same pack's
// objects twice -- only credit the subscription when that insert really
// adds a new row, not when it's a no-op duplicate.
async function grantPackPurchase(
  db: ReturnType<typeof createDb>,
  params: {
    ownerId: string;
    stripeCustomerId: string;
    packTier: PackTier;
    objectsGranted: number | null;
    amountCents: number;
    stripeCheckoutSessionId: string;
  }
) {
  const now = new Date();

  const inserted = await db
    .insert(packPurchase)
    .values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: params.ownerId,
      packTier: params.packTier,
      objectsGranted: params.objectsGranted,
      amountCents: params.amountCents,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: packPurchase.id });

  if (inserted.length === 0) return; // already processed this checkout session

  const [existing] = await db
    .select({ id: subscription.id, tier: subscription.tier })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, params.ownerId)))
    .limit(1);

  // Never downgrade an existing Enterprise owner, and always promote up
  // to Enterprise regardless of what tier came before.
  const nextTier = params.packTier === "enterprise" || existing?.tier === "enterprise" ? "enterprise" : "project_pack";

  if (existing) {
    await db
      .update(subscription)
      .set({
        tier: nextTier,
        // Project Pack quotas stack across purchases; Enterprise is
        // unlimited and ignores this column, so there's nothing to add.
        objectsRemaining:
          params.objectsGranted === null ? sql`${subscription.objectsRemaining}` : sql`${subscription.objectsRemaining} + ${params.objectsGranted}`,
        stripeCustomerId: params.stripeCustomerId,
        status: "active",
        updatedAt: now,
      })
      .where(eq(subscription.id, existing.id));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId: params.ownerId,
      stripeCustomerId: params.stripeCustomerId,
      tier: nextTier,
      status: "active",
      objectsRemaining: params.objectsGranted ?? 0,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}
