import { Hono } from "hono";
import { createDb } from "../lib/db/client";
import { requireAuth } from "../middleware/require-auth";
import { resolvePlanTier } from "../middleware/require-plan";
import { peekObjectsRemaining } from "../lib/billing/object-quota";
import { computeProcessingStats } from "../lib/stats";
import type { AppBindings } from "../types/hono";

export const usageRoute = new Hono<AppBindings>()
  .get("/", requireAuth, resolvePlanTier, async (c) => {
    const tier = c.get("planTier");
    const ownerType = c.get("ownerType");
    const ownerId = c.get("ownerId");
    const db = createDb(c.env.DB);

    // null means unlimited (Enterprise) -- there's no quota to read.
    const objectsRemaining =
      tier === "enterprise" ? null : await peekObjectsRemaining(db, { ownerType, ownerId }, Number(c.env.FREE_OBJECT_LIMIT));

    return c.json({ tier, objectsRemaining });
  })
  .get("/stats", requireAuth, resolvePlanTier, async (c) => {
    const ownerType = c.get("ownerType");
    const ownerId = c.get("ownerId");
    const db = createDb(c.env.DB);

    const stats = await computeProcessingStats(db, { ownerType, ownerId }, new Date());
    return c.json(stats);
  });
