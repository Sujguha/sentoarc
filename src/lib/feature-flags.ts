import { eq } from "drizzle-orm";
import { featureFlag } from "./db/schema";
import type { Db } from "./db/client";

// Defaults to false (safe/off) for a flag that was never created --
// same reasoning as every other "missing row = baseline behavior"
// pattern in this codebase (e.g. resolvePlanTierFor's implicit free
// tier), so a feature gated behind a not-yet-created flag stays off
// rather than erroring.
export async function isFeatureEnabled(db: Db, key: string): Promise<boolean> {
  const [row] = await db.select({ enabled: featureFlag.enabled }).from(featureFlag).where(eq(featureFlag.key, key)).limit(1);
  return row?.enabled ?? false;
}

export async function setFeatureFlag(db: Db, key: string, enabled: boolean, description?: string | null): Promise<void> {
  const now = new Date();
  const [existing] = await db.select({ key: featureFlag.key }).from(featureFlag).where(eq(featureFlag.key, key)).limit(1);

  if (existing) {
    const updates: { enabled: boolean; updatedAt: Date; description?: string | null } = { enabled, updatedAt: now };
    if (description !== undefined) updates.description = description;
    await db.update(featureFlag).set(updates).where(eq(featureFlag.key, key));
  } else {
    await db.insert(featureFlag).values({ key, enabled, description: description ?? null, updatedAt: now });
  }
}

export async function deleteFeatureFlag(db: Db, key: string): Promise<void> {
  await db.delete(featureFlag).where(eq(featureFlag.key, key));
}
