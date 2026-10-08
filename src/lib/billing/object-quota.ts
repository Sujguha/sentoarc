import { and, eq, sql } from "drizzle-orm";
import { subscription } from "../db/schema";
import type { Db } from "../db/client";

export interface ObjectOwner {
  ownerType: "user" | "org";
  ownerId: string;
}

export interface ConsumeObjectResult {
  ok: boolean;
  objectsRemaining: number;
}

// Reads how many objects this owner has left, without consuming one or
// writing anything -- used for an upfront "can this whole batch even
// fit" check (bulk/init) and for display (GET /api/usage). An owner with
// no subscription row yet (never uploaded) is implicitly free-tier with
// a full, untouched quota.
export async function peekObjectsRemaining(db: Db, owner: ObjectOwner, freeObjectLimit: number): Promise<number> {
  const [existing] = await db
    .select({ objectsRemaining: subscription.objectsRemaining })
    .from(subscription)
    .where(and(eq(subscription.ownerType, owner.ownerType), eq(subscription.ownerId, owner.ownerId)))
    .limit(1);
  return existing?.objectsRemaining ?? freeObjectLimit;
}

// Atomically decrements the owner's object quota by one -- the real,
// race-safe enforcement (objects_remaining >= 1 in the WHERE clause,
// same conditional-UPDATE pattern the old prepaid balance used) so two
// uploads landing concurrently can never both succeed against a quota
// that can only actually cover one of them. Never call this for
// tier === "enterprise" -- that tier is unlimited and has no quota to
// consume; callers check tier before reaching here.
export async function consumeObject(db: Db, owner: ObjectOwner, freeObjectLimit: number): Promise<ConsumeObjectResult> {
  const now = new Date();

  // The conditional UPDATE below only works once a row exists. A
  // brand-new free-tier owner (nothing created yet -- resolvePlanTierFor's
  // implicit "free" fallback) has none, so lazily create one with the
  // free default first, mirroring the lazy-creation pattern already used
  // elsewhere in this codebase (e.g. the old free-upload counter). A rare
  // concurrent double-create on someone's very first upload is an
  // accepted, pre-existing tradeoff here, not a new risk.
  const [existing] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(and(eq(subscription.ownerType, owner.ownerType), eq(subscription.ownerId, owner.ownerId)))
    .limit(1);

  if (!existing) {
    await db.insert(subscription).values({
      id: crypto.randomUUID(),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      tier: "free",
      status: "active",
      objectsRemaining: freeObjectLimit,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const updated = await db
    .update(subscription)
    .set({ objectsRemaining: sql`${subscription.objectsRemaining} - 1`, updatedAt: now })
    .where(
      and(
        eq(subscription.ownerType, owner.ownerType),
        eq(subscription.ownerId, owner.ownerId),
        sql`${subscription.objectsRemaining} >= 1`
      )
    )
    .returning({ objectsRemaining: subscription.objectsRemaining });

  if (updated.length === 0) {
    const [current] = await db
      .select({ objectsRemaining: subscription.objectsRemaining })
      .from(subscription)
      .where(and(eq(subscription.ownerType, owner.ownerType), eq(subscription.ownerId, owner.ownerId)))
      .limit(1);
    return { ok: false, objectsRemaining: current?.objectsRemaining ?? 0 };
  }

  return { ok: true, objectsRemaining: updated[0]?.objectsRemaining ?? 0 };
}

// Gives back one object -- used when an upload already consumed one
// (the normal per-file charge) but turns out not to be a real
// deliverable after all, e.g. a zip-of-zips container that gets expanded
// into its own inner packages, each of which consumes its own object
// (see expandZipOfZips in queue-consumer.ts). Assumes a row already
// exists (the earlier consumeObject call that charged it would have
// created one).
export async function refundObject(db: Db, owner: ObjectOwner): Promise<void> {
  await db
    .update(subscription)
    .set({ objectsRemaining: sql`${subscription.objectsRemaining} + 1`, updatedAt: new Date() })
    .where(and(eq(subscription.ownerType, owner.ownerType), eq(subscription.ownerId, owner.ownerId)));
}
