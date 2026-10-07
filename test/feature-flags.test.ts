import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { featureFlag } from "../src/lib/db/schema";
import { isFeatureEnabled, setFeatureFlag, deleteFeatureFlag } from "../src/lib/feature-flags";

describe("isFeatureEnabled", () => {
  it("defaults to false for a flag that was never created", async () => {
    const db = createDb(env.DB);
    expect(await isFeatureEnabled(db, "never-created")).toBe(false);
  });

  it("reflects a created flag's enabled state", async () => {
    const db = createDb(env.DB);
    await setFeatureFlag(db, "new-pricing-page", true, "Test flag");
    expect(await isFeatureEnabled(db, "new-pricing-page")).toBe(true);

    await setFeatureFlag(db, "new-pricing-page", false);
    expect(await isFeatureEnabled(db, "new-pricing-page")).toBe(false);
  });
});

describe("setFeatureFlag", () => {
  it("creates a new flag with the given description", async () => {
    const db = createDb(env.DB);
    await setFeatureFlag(db, "beta-connector", true, "Enables the beta connector UI");

    const [row] = await db.select().from(featureFlag).where(eq(featureFlag.key, "beta-connector")).limit(1);
    expect(row).toMatchObject({ key: "beta-connector", enabled: true, description: "Enables the beta connector UI" });
  });

  it("updates an existing flag's enabled state without clearing its description when none is given", async () => {
    const db = createDb(env.DB);
    await setFeatureFlag(db, "beta-connector", true, "Enables the beta connector UI");

    await setFeatureFlag(db, "beta-connector", false); // description omitted
    const [row] = await db.select().from(featureFlag).where(eq(featureFlag.key, "beta-connector")).limit(1);
    expect(row).toMatchObject({ enabled: false, description: "Enables the beta connector UI" });
  });

  it("clears the description when explicitly passed null", async () => {
    const db = createDb(env.DB);
    await setFeatureFlag(db, "beta-connector", true, "Enables the beta connector UI");

    await setFeatureFlag(db, "beta-connector", true, null);
    const [row] = await db.select().from(featureFlag).where(eq(featureFlag.key, "beta-connector")).limit(1);
    expect(row?.description).toBeNull();
  });
});

describe("deleteFeatureFlag", () => {
  it("removes the flag row", async () => {
    const db = createDb(env.DB);
    await setFeatureFlag(db, "temp-flag", true);
    expect(await isFeatureEnabled(db, "temp-flag")).toBe(true);

    await deleteFeatureFlag(db, "temp-flag");
    expect(await isFeatureEnabled(db, "temp-flag")).toBe(false);
  });

  it("is a no-op for a flag that doesn't exist", async () => {
    const db = createDb(env.DB);
    await expect(deleteFeatureFlag(db, "never-existed")).resolves.toBeUndefined();
  });
});
