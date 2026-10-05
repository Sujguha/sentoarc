import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// --- better-auth core tables -------------------------------------------
// Hand-written to match better-auth's expected schema for the sqlite/drizzle
// adapter. Once `wrangler dev` + a dev D1 are set up, run
// `npx @better-auth/cli generate` to verify/diff this against the installed
// plugin set (core + emailOTP/magicLink + organization) before relying on it.

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// --- better-auth organization plugin -----------------------------------
// Owns Enterprise orgs + membership + role (admin / editor / viewer,
// enforced in app code — better-auth stores role as a plain string).

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const member = sqliteTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  inviterId: text("inviter_id").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- app tables ----------------------------------------------------------

export const subscription = sqliteTable("subscription", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: ["user", "org"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  tier: text("tier", { enum: ["free", "pro", "enterprise"] }).notNull().default("free"),
  status: text("status").notNull().default("active"),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  seats: integer("seats").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const usageCounter = sqliteTable("usage_counter", {
  ownerType: text("owner_type", { enum: ["user", "org"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  metric: text("metric").notNull(),
  value: integer("value").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.ownerType, t.ownerId, t.metric] })]);

export const job = sqliteTable("job", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: ["user", "org"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
  status: text("status", {
    enum: ["queued", "processing", "completed", "completed_with_errors", "failed"],
  }).notNull().default("queued"),
  sourceType: text("source_type", { enum: ["single", "bulk_zip_of_zips", "bulk_multi"] }).notNull(),
  totalPackages: integer("total_packages").notNull().default(0),
  completedPackages: integer("completed_packages").notNull().default(0),
  failedPackages: integer("failed_packages").notNull().default(0),
  retentionExpiresAt: integer("retention_expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const pkg = sqliteTable("package", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => job.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  r2KeyUpload: text("r2_key_upload").notNull(),
  r2KeyFixed: text("r2_key_fixed"),
  status: text("status", {
    enum: ["pending", "queued", "processing", "pass", "fixed", "failed"],
  }).notNull().default("pending"),
  inputFormat: text("input_format", {
    enum: ["scorm", "pdf", "mp4", "pptx", "html"],
  }),
  scormVersionIn: text("scorm_version_in"),
  scormVersionOut: text("scorm_version_out"),
  sizeBytes: integer("size_bytes"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const packageIssue = sqliteTable("package_issue", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => pkg.id, { onDelete: "cascade" }),
  severity: text("severity", { enum: ["info", "warning", "error"] }).notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  fixApplied: integer("fix_applied", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const contactSalesLead = sqliteTable("contact_sales_lead", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  companySize: text("company_size"),
  message: text("message"),
  status: text("status", { enum: ["new", "contacted", "closed"] }).notNull().default("new"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const connector = sqliteTable("connector", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  configJson: text("config_json"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const connectorDelivery = sqliteTable("connector_delivery", {
  id: text("id").primaryKey(),
  connectorId: text("connector_id").notNull().references(() => connector.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull().references(() => job.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  attemptedAt: integer("attempted_at", { mode: "timestamp" }).notNull(),
  responseJson: text("response_json"),
});
