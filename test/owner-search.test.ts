import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/client";
import { user as userTable, organization, subscription } from "../src/lib/db/schema";
import { searchOwners } from "../src/lib/owner-search";

async function seedUser(email: string, name = "Test User"): Promise<string> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(userTable).values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now });
  return id;
}

async function seedOrg(name: string): Promise<string> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  await db.insert(organization).values({ id, name, createdAt: new Date() });
  return id;
}

async function seedSubscription(ownerType: "user" | "org", ownerId: string, tier: string, retentionDaysOverride: number | null = null) {
  const db = createDb(env.DB);
  const now = new Date();
  await db.insert(subscription).values({
    id: crypto.randomUUID(),
    ownerType,
    ownerId,
    tier: tier as "free" | "pro" | "enterprise" | "metered",
    status: "active",
    retentionDaysOverride,
    seats: 1,
    createdAt: now,
    updatedAt: now,
  });
}

describe("searchOwners", () => {
  it("finds a matching user by a substring of their email", async () => {
    const userId = await seedUser("founder@acme.example.com", "Acme Founder");
    const db = createDb(env.DB);

    const results = await searchOwners(db, "acme.example");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ownerType: "user", ownerId: userId, tier: "free", retentionDaysOverride: null });
    expect(results[0]?.label).toContain("founder@acme.example.com");
  });

  it("finds a matching org by a substring of its name", async () => {
    const orgId = await seedOrg("Acme Corporation");
    const db = createDb(env.DB);

    const results = await searchOwners(db, "Acme Corp");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ownerType: "org", ownerId: orgId, label: "Acme Corporation" });
  });

  it("includes the current tier and retention override when a subscription row exists", async () => {
    const userId = await seedUser("pro-user@example.com");
    await seedSubscription("user", userId, "pro", 90);
    const db = createDb(env.DB);

    const results = await searchOwners(db, "pro-user");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ tier: "pro", retentionDaysOverride: 90 });
  });

  it("returns an empty list when nothing matches", async () => {
    await seedUser("someone@example.com");
    const db = createDb(env.DB);

    const results = await searchOwners(db, "nobody-matches-this");
    expect(results).toEqual([]);
  });
});
