import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { createDb } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { createStripeClient, createStripeCryptoProvider } from "../lib/billing/stripe-client";
import type { AppBindings } from "../types/hono";

export const billingRoute = new Hono<AppBindings>();

// Pay-as-you-go is prepaid balance (see /topup below), not a Stripe
// subscription -- a customer can top up any amount at or above this,
// no pre-created Stripe Price needed since the amount is theirs to pick.
const MIN_TOPUP_CENTS = 200;

// Checkout: starts a new Pro subscription, or resumes billing for a
// user who already has a Stripe customer (e.g. a previously cancelled
// sub). Seats are fixed at 1 for now -- Enterprise (multi-seat, roles)
// is a contact-sales flow, not self-serve checkout.
billingRoute.post("/checkout", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ interval?: "month" | "year" }>().catch(() => ({ interval: undefined }));
  const interval = body.interval === "year" ? "year" : "month";
  const priceId = interval === "year" ? c.env.STRIPE_PRICE_ID_YEARLY : c.env.STRIPE_PRICE_ID_MONTHLY;
  if (!priceId) {
    return c.json({ error: "billing_not_configured" }, 503);
  }

  const db = createDb(c.env.DB);
  const [existing] = await db
    .select({ stripeCustomerId: subscription.stripeCustomerId })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, user.id)))
    .limit(1);

  const stripe = createStripeClient(c.env);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    ...(existing?.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : { customer_email: user.email }),
    success_url: `${c.env.APP_BASE_URL}/account?checkout=success`,
    cancel_url: `${c.env.APP_BASE_URL}/account?checkout=cancelled`,
  });

  if (!session.url) {
    return c.json({ error: "checkout_session_failed" }, 502);
  }
  return c.json({ url: session.url });
});

// Top up the prepaid pay-as-you-go balance. A one-time payment, not a
// subscription -- the amount is chosen by the customer at checkout
// time, so it's built as an inline price_data line item rather than a
// pre-created Stripe Price (there's no fixed set of amounts to
// pre-create prices for).
billingRoute.post("/topup", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ amountCents?: number }>().catch(() => null);
  const amountCents = body?.amountCents;
  if (amountCents === undefined || !Number.isInteger(amountCents) || amountCents < MIN_TOPUP_CENTS) {
    return c.json({ error: "invalid_amount", minCents: MIN_TOPUP_CENTS }, 400);
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
          unit_amount: amountCents,
          product_data: { name: "SENtoArc pay-as-you-go balance top-up" },
        },
        quantity: 1,
      },
    ],
    client_reference_id: user.id,
    ...(existing?.stripeCustomerId
      ? { customer: existing.stripeCustomerId }
      : { customer_email: user.email }),
    success_url: `${c.env.APP_BASE_URL}/account?checkout=success`,
    cancel_url: `${c.env.APP_BASE_URL}/account?checkout=cancelled`,
  });

  if (!session.url) {
    return c.json({ error: "checkout_session_failed" }, 502);
  }
  return c.json({ url: session.url });
});

// Billing portal: lets an existing Pro customer manage/cancel their own
// subscription without us building that UI ourselves.
billingRoute.post("/portal", requireAuth, async (c) => {
  const user = c.get("user");
  const db = createDb(c.env.DB);

  const [row] = await db
    .select({ stripeCustomerId: subscription.stripeCustomerId })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, user.id)))
    .limit(1);

  if (!row?.stripeCustomerId) {
    return c.json({ error: "no_stripe_customer" }, 400);
  }

  const stripe = createStripeClient(c.env);
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${c.env.APP_BASE_URL}/account`,
  });

  return c.json({ url: session.url });
});

// Stripe webhook: the source of truth for subscription state. Never
// trust client-reported plan tier -- only this handler, driven by
// Stripe's own signed events, writes to the subscription table.
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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const ownerId = session.client_reference_id;
      if (!ownerId || typeof session.customer !== "string") break;

      if (session.mode === "payment") {
        // A top-up: credit the prepaid balance by what was actually
        // paid, per Stripe's own record of the amount -- never a
        // client-sent value.
        await creditPrepaidBalance(db, ownerId, session.customer, session.amount_total ?? 0);
      } else if (typeof session.subscription === "string") {
        await upsertSubscriptionFromStripeSubscription(stripe, db, ownerId, session.customer, session.subscription);
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const stripeSub = event.data.object as Stripe.Subscription;
      await syncSubscriptionRow(db, stripeSub);
      break;
    }

    default:
      break;
  }

  return c.json({ received: true });
});

async function upsertSubscriptionFromStripeSubscription(
  stripe: Stripe,
  db: ReturnType<typeof createDb>,
  ownerId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string
) {
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  await writeSubscriptionRow(db, "user", ownerId, stripeCustomerId, stripeSub);
}

// customer.subscription.* events don't carry our internal ownerId, only
// the Stripe customer/subscription ids -- look up the existing row by
// stripeCustomerId (set during checkout.session.completed) to find it.
async function syncSubscriptionRow(db: ReturnType<typeof createDb>, stripeSub: Stripe.Subscription) {
  const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;

  const [existing] = await db
    .select({ ownerType: subscription.ownerType, ownerId: subscription.ownerId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1);

  if (!existing) return; // no local row to reconcile (shouldn't happen post-checkout)

  await writeSubscriptionRow(db, existing.ownerType, existing.ownerId, customerId, stripeSub);
}

// Credits a one-time top-up payment to the owner's prepaid balance.
// Pay-as-you-go has no Stripe subscription of its own anymore, so this
// is the only place that tier ever gets set to "metered" -- the first
// top-up is what puts a free-tier account onto it; an existing Pro/
// Enterprise account keeps its tier (the balance just sits there
// dormant, e.g. for later if they ever downgrade).
async function creditPrepaidBalance(
  db: ReturnType<typeof createDb>,
  ownerId: string,
  stripeCustomerId: string,
  amountCents: number
) {
  const now = new Date();
  const [existing] = await db
    .select({ id: subscription.id, tier: subscription.tier })
    .from(subscription)
    .where(and(eq(subscription.ownerType, "user"), eq(subscription.ownerId, ownerId)))
    .limit(1);

  if (existing) {
    await db
      .update(subscription)
      .set({
        balanceCents: sql`${subscription.balanceCents} + ${amountCents}`,
        stripeCustomerId,
        tier: existing.tier === "free" ? "metered" : existing.tier,
        status: "active",
        updatedAt: now,
      })
      .where(eq(subscription.id, existing.id));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: "user",
      ownerId,
      stripeCustomerId,
      tier: "metered",
      status: "active",
      balanceCents: amountCents,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function writeSubscriptionRow(
  db: ReturnType<typeof createDb>,
  ownerType: "user" | "org",
  ownerId: string,
  stripeCustomerId: string,
  stripeSub: Stripe.Subscription
) {
  const now = new Date();
  const priceId = stripeSub.items.data[0]?.price.id ?? null;
  // The only Stripe subscriptions left are Pro monthly/yearly --
  // pay-as-you-go is prepaid balance now, never a subscription tier
  // resolved from a price id.
  const tier = stripeSub.status === "canceled" || stripeSub.status === "incomplete_expired" ? "free" : "pro";

  const [existing] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .limit(1);

  const values = {
    stripeCustomerId,
    stripeSubscriptionId: stripeSub.id,
    stripePriceId: priceId,
    tier: tier as "free" | "pro" | "metered",
    status: stripeSub.status,
    currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
    seats: stripeSub.items.data[0]?.quantity ?? 1,
    updatedAt: now,
  };

  if (existing) {
    await db.update(subscription).set(values).where(eq(subscription.id, existing.id));
  } else {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType,
      ownerId,
      ...values,
      createdAt: now,
    });
  }
}
