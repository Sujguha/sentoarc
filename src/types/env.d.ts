export interface Env {
  DB: D1Database;
  PACKAGES_BUCKET: R2Bucket;
  PACKAGE_QUEUE: Queue;
  ASSETS: Fetcher;

  // How many objects (converted files) a free-tier owner gets, for life
  // -- not a monthly allowance. Matches the `objects_remaining` column's
  // own default (see migration 0009); kept as a var so it can be tuned
  // without a migration for a *future* signup, though an already-seeded
  // free row's remaining count only ever heads downward.
  FREE_OBJECT_LIMIT: string;
  MAX_PACKAGE_SIZE_BYTES: string;
  // Video (.mp4/.webm/.mov) gets its own, larger cap -- Learning Arc
  // itself accepts up to 500MB for video vs 200MB for everything else,
  // and a flat cap sized for documents would reject videos the
  // platform we're targeting would happily take directly.
  MAX_VIDEO_SIZE_BYTES: string;
  FREE_RETENTION_HOURS: string;
  PRO_RETENTION_DAYS: string;
  ADMIN_EMAILS: string;
  APP_BASE_URL: string;

  BETTER_AUTH_SECRET: string;
  SENDGRID_API_KEY: string;
  SENDGRID_FROM_EMAIL: string;
  SENDGRID_FROM_NAME: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  // One-time packs, self-serve via Stripe Checkout (mode: "payment") --
  // no subscriptions and no pre-created Stripe Prices; the amount is
  // built as inline price_data at checkout time (see billing.ts).
  PROJECT_PACK_PRICE_CENTS: string;
  PROJECT_PACK_OBJECTS: string;
  ENTERPRISE_PACK_PRICE_CENTS: string;
}

export type ProcessingQueueMessage = { type: "process"; jobId: string; packageId: string; r2Key: string };
