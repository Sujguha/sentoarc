export interface Env {
  DB: D1Database;
  PACKAGES_BUCKET: R2Bucket;
  PACKAGE_QUEUE: Queue;
  ASSETS: Fetcher;

  FREE_UPLOAD_LIMIT: string;
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
  STRIPE_PRICE_ID_MONTHLY: string;
  STRIPE_PRICE_ID_YEARLY: string;
  // Pay-as-you-go tier: prepaid, not a Stripe subscription -- topped up
  // via one-time Checkout payments (dynamic amount, no pre-created
  // Stripe Price needed) and deducted per upload. This is the price per
  // MB processed, in cents.
  METERED_UNIT_PRICE_CENTS: string;
}

export type ProcessingQueueMessage = { type: "process"; jobId: string; packageId: string; r2Key: string };
