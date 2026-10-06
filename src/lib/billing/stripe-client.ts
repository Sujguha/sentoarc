import Stripe from "stripe";
import type { Env } from "../../types/env";

// Workers has no Node `http`/`crypto` module, so stripe-node needs the
// fetch-based HTTP client explicitly, and webhook signature verification
// needs the async + Web Crypto (SubtleCrypto) path rather than the
// default Node crypto one.
export function createStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-02-24.acacia",
  });
}

export function createStripeCryptoProvider() {
  return Stripe.createSubtleCryptoProvider();
}
