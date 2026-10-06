import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type Stripe from "stripe";
import { createDb } from "../lib/db/client";
import { subscription } from "../lib/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { createStripeClient, createStripeCryptoProvider } from "../lib/billing/stripe-client";
import type { AppBindings } from "../types/hono";

export const billingRoute = new Hono<AppBindings>();

// Checkout: starts a new Pro subscription, or resumes billing for a user
// who already has a Stripe customer (e.g. a previously cancelled sub).
// Seats are fixed at 1 for now -- Enterprise (multi-seat, roles) is a
// contact-sales flow, not self-serve checkout.
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
      if (!ownerId || typeof session.customer !== "string" || typeof session.subscription !== "string") {
        break;
      }
      await upsertSubscriptionFromStripeSubscription(stripe, db, ownerId, session.customer, session.subscription);
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

async function writeSubscriptionRow(
  db: ReturnType<typeof createDb>,
  ownerType: "user" | "org",
  ownerId: string,
  stripeCustomerId: string,
  stripeSub: Stripe.Subscription
) {
  const now = new Date();
  const priceId = stripeSub.items.data[0]?.price.id ?? null;
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
    tier: tier as "free" | "pro",
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
