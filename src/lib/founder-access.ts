import type { Env } from "../types/env";

// "Founder" means an allowlisted operator email (ADMIN_EMAILS), not an
// organization role -- shared by requireAdmin (/admin/* routes) and the
// organization-creation gate below, so there's one source of truth for
// "is this the person running SENtoArc" rather than two copies that can
// drift.
export function isFounderEmail(env: Env, email: string): boolean {
  const allowed = env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase());
  return allowed.includes(email.toLowerCase());
}
