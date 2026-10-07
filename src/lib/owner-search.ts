import { eq, and, like } from "drizzle-orm";
import { subscription, user, organization } from "./db/schema";
import type { Db } from "./db/client";

export interface OwnerSearchResult {
  ownerType: "user" | "org";
  ownerId: string;
  label: string;
  tier: string;
  retentionDaysOverride: number | null;
}

async function currentSubscription(db: Db, ownerType: "user" | "org", ownerId: string) {
  const [sub] = await db
    .select({ tier: subscription.tier, retentionDaysOverride: subscription.retentionDaysOverride })
    .from(subscription)
    .where(and(eq(subscription.ownerType, ownerType), eq(subscription.ownerId, ownerId)))
    .limit(1);
  return { tier: sub?.tier ?? "free", retentionDaysOverride: sub?.retentionDaysOverride ?? null };
}

// Finds candidate owners by user email or org name so the admin tier/
// retention override routes (which only take an already-known
// ownerType/ownerId) can actually be used from a UI instead of only by
// someone who already knows the raw id to curl.
export async function searchOwners(db: Db, q: string): Promise<OwnerSearchResult[]> {
  const pattern = `%${q}%`;

  const matchedUsers = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(like(user.email, pattern))
    .limit(10);
  const matchedOrgs = await db.select({ id: organization.id, name: organization.name }).from(organization).where(like(organization.name, pattern)).limit(10);

  return Promise.all([
    ...matchedUsers.map(async (u) => ({
      ownerType: "user" as const,
      ownerId: u.id,
      label: `${u.name} (${u.email})`,
      ...(await currentSubscription(db, "user", u.id)),
    })),
    ...matchedOrgs.map(async (o) => ({
      ownerType: "org" as const,
      ownerId: o.id,
      label: o.name,
      ...(await currentSubscription(db, "org", o.id)),
    })),
  ]);
}
