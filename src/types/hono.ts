import type { Env } from "./env";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export type OrgRole = "admin" | "editor" | "viewer";

export interface HonoVariables {
  user: AuthedUser;
  // Set by requireAuth from the better-auth session; the org the user has
  // currently switched to, if any (set via /api/auth/organization/set-active).
  activeOrganizationId: string | null;
  planTier: "free" | "pro" | "enterprise";
  // Set by resolvePlanTier: who the request is actually acting as --
  // the active org (if the user is still a verified member of it) or
  // the user themself. Every owner-scoped query should use these, not
  // `user.id` directly, so a job/upload lands in the right workspace.
  ownerType: "user" | "org";
  ownerId: string;
  // Only set when ownerType is "org" -- the caller's role in that org.
  orgRole: OrgRole | null;
  // Set by resolvePlanTier alongside planTier -- a founder-set override
  // (see admin retention route) on the resolved owner's subscription row,
  // or null to use the tier default.
  retentionDaysOverride: number | null;
}

export interface AppBindings {
  Bindings: Env;
  Variables: HonoVariables;
}
