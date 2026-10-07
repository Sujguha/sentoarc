import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/lib/db/client";
import { processingStat } from "../src/lib/db/schema";
import { computeProcessingStats, type Owner } from "../src/lib/stats";

// Fixed "now" so month/quarter boundaries are deterministic: May 2026 is
// Q2 (Apr-Jun), and the 6-month trend window (TREND_MONTHS) runs
// Dec 2025 through May 2026.
const NOW = new Date("2026-05-15T12:00:00Z");

async function insertStat(opts: { ownerType: "user" | "org"; ownerId: string; sizeBytes: number; createdAt: Date; status?: "pass" | "fixed" | "failed" }) {
  const db = createDb(env.DB);
  await db.insert(processingStat).values({
    id: crypto.randomUUID(),
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    sizeBytes: opts.sizeBytes,
    status: opts.status ?? "pass",
    createdAt: opts.createdAt,
  });
}

const OWNER: Owner = { ownerType: "user", ownerId: "owner-x" };
const OTHER_OWNER: Owner = { ownerType: "user", ownerId: "owner-y" };

describe("computeProcessingStats", () => {
  it("returns all-zero stats and a zero-filled 6-month trend with no data", async () => {
    const db = createDb(env.DB);
    const stats = await computeProcessingStats(db, OWNER, NOW);

    expect(stats.allTime).toEqual({ count: 0, totalBytes: 0, avgBytes: 0 });
    expect(stats.thisMonth).toEqual({ count: 0, totalBytes: 0, avgBytes: 0 });
    expect(stats.thisQuarter).toEqual({ count: 0, totalBytes: 0, avgBytes: 0 });
    expect(stats.monthlyTrend).toHaveLength(6);
    expect(stats.monthlyTrend.map((m) => m.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(stats.monthlyTrend.every((m) => m.count === 0 && m.totalBytes === 0)).toBe(true);
  });

  it("buckets rows into this-month / this-quarter / all-time correctly at the boundaries", async () => {
    await insertStat({ ...OWNER, sizeBytes: 10 * 1024 * 1024, createdAt: new Date("2026-05-10T00:00:00Z") }); // this month + this quarter
    await insertStat({ ...OWNER, sizeBytes: 20 * 1024 * 1024, createdAt: new Date("2026-04-20T00:00:00Z") }); // last month, same quarter
    await insertStat({ ...OWNER, sizeBytes: 5 * 1024 * 1024, createdAt: new Date("2026-02-01T00:00:00Z") }); // different quarter
    await insertStat({ ...OWNER, sizeBytes: 1 * 1024 * 1024, createdAt: new Date("2025-11-01T00:00:00Z") }); // before the trend window, still all-time

    const db = createDb(env.DB);
    const stats = await computeProcessingStats(db, OWNER, NOW);

    expect(stats.thisMonth).toEqual({ count: 1, totalBytes: 10 * 1024 * 1024, avgBytes: 10 * 1024 * 1024 });
    expect(stats.thisQuarter).toEqual({ count: 2, totalBytes: 30 * 1024 * 1024, avgBytes: 15 * 1024 * 1024 });
    expect(stats.allTime).toEqual({ count: 4, totalBytes: 36 * 1024 * 1024, avgBytes: 9 * 1024 * 1024 });

    // The Nov 2025 row is before the 6-month trend window (Dec-May) and
    // must not appear in it, even though it counts toward all-time.
    const novBucket = stats.monthlyTrend.find((m) => m.month === "2025-11");
    expect(novBucket).toBeUndefined();
    const febBucket = stats.monthlyTrend.find((m) => m.month === "2026-02");
    expect(febBucket).toEqual({ month: "2026-02", count: 1, totalBytes: 5 * 1024 * 1024 });
  });

  it("scopes stats to the given owner and excludes other owners' rows", async () => {
    await insertStat({ ...OWNER, sizeBytes: 1024, createdAt: NOW });
    await insertStat({ ...OTHER_OWNER, sizeBytes: 2048, createdAt: NOW });

    const db = createDb(env.DB);
    const mine = await computeProcessingStats(db, OWNER, NOW);
    const theirs = await computeProcessingStats(db, OTHER_OWNER, NOW);

    expect(mine.allTime).toEqual({ count: 1, totalBytes: 1024, avgBytes: 1024 });
    expect(theirs.allTime).toEqual({ count: 1, totalBytes: 2048, avgBytes: 2048 });
  });

  it("with owner=null (platform-wide/admin) aggregates across every owner", async () => {
    await insertStat({ ...OWNER, sizeBytes: 1000, createdAt: NOW });
    await insertStat({ ...OTHER_OWNER, sizeBytes: 2000, createdAt: NOW });

    const db = createDb(env.DB);
    const platformWide = await computeProcessingStats(db, null, NOW);

    expect(platformWide.allTime).toEqual({ count: 2, totalBytes: 3000, avgBytes: 1500 });
  });

  it("counts a failed package the same as a successful one (still real throughput)", async () => {
    await insertStat({ ...OWNER, sizeBytes: 4096, createdAt: NOW, status: "failed" });

    const db = createDb(env.DB);
    const stats = await computeProcessingStats(db, OWNER, NOW);

    expect(stats.allTime).toEqual({ count: 1, totalBytes: 4096, avgBytes: 4096 });
  });
});
