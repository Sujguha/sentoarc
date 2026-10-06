export interface Env {
  DB: D1Database;
  PACKAGES_BUCKET: R2Bucket;
  PACKAGE_QUEUE: Queue;
  ASSETS: Fetcher;

  FREE_UPLOAD_LIMIT: string;
  MAX_PACKAGE_SIZE_BYTES: string;
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
  // Pay-as-you-go tier: a Stripe metered Price (no fixed quantity) and
  // the Billing Meter event_name it's attached to. Left empty until a
  // metered Price + Meter are set up in the Stripe dashboard -- checkout
  // returns "billing_not_configured" while unset, same as the Pro prices.
  STRIPE_PRICE_ID_METERED: string;
  STRIPE_METER_EVENT_NAME: string;
}

export type ProcessingQueueMessage = { type: "process"; jobId: string; packageId: string; r2Key: string };
