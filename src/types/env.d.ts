export interface Env {
  DB: D1Database;
  PACKAGES_BUCKET: R2Bucket;
  PACKAGE_QUEUE: Queue;
  ASSETS: Fetcher;

  FREE_UPLOAD_LIMIT: string;
  FREE_RETENTION_HOURS: string;
  PRO_RETENTION_DAYS: string;
  ADMIN_EMAILS: string;
  APP_BASE_URL: string;

  BETTER_AUTH_SECRET: string;
  SENDGRID_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export type ProcessingQueueMessage =
  | { type: "process"; jobId: string; packageId: string; r2Key: string }
  | { type: "unpack"; jobId: string; packageId: string; r2Key: string };
