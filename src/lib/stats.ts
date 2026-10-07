import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { processingStat } from "./db/schema";
import type { Db } from "./db/client";

export interface PeriodStats {
  count: number;
  totalBytes: number;
  avgBytes: number;
}

export interface MonthlyStat {
  month: string; // "YYYY-MM"
  count: number;
  totalBytes: number;
}

export interface ProcessingStats {
  allTime: PeriodStats;
  thisMonth: PeriodStats;
  thisQuarter: PeriodStats;
  // Oldest first, one entry per month, zero-filled so a quiet month
  // doesn't just disappear from the trend chart.
  monthlyTrend: MonthlyStat[];
}

const TREND_MONTHS = 6;

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfQuarter(d: Date): Date {
  const quarter = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), quarter * 3, 1));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toPeriodStats(row: { count: number | null; total: number | null } | undefined): PeriodStats {
  const count = row?.count ?? 0;
  const totalBytes = row?.total ?? 0;
  return { count, totalBytes, avgBytes: count > 0 ? Math.round(totalBytes / count) : 0 };
}

export type Owner = { ownerType: "user" | "org"; ownerId: string };

// owner === null computes platform-wide stats (admin); otherwise scoped
// to that one user/org (personal usage stats).
export async function computeProcessingStats(db: Db, owner: Owner | null, now: Date): Promise<ProcessingStats> {
  const ownerFilter: SQL | undefined = owner
    ? and(eq(processingStat.ownerType, owner.ownerType), eq(processingStat.ownerId, owner.ownerId))
    : undefined;

  async function periodStats(since: Date | null): Promise<PeriodStats> {
    const clauses = [ownerFilter, since ? gte(processingStat.createdAt, since) : undefined].filter(
      (c): c is SQL => c !== undefined
    );
    const [row] = await db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${processingStat.sizeBytes}), 0)` })
      .from(processingStat)
      .where(clauses.length > 0 ? and(...clauses) : undefined);
    return toPeriodStats(row);
  }

  const trendStart = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1), 1)));
  const trendClauses = [ownerFilter, gte(processingStat.createdAt, trendStart)].filter((c): c is SQL => c !== undefined);
  const monthExpr = sql<string>`strftime('%Y-%m', ${processingStat.createdAt}, 'unixepoch')`;
  const trendRows = await db
    .select({ month: monthExpr, count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${processingStat.sizeBytes}), 0)` })
    .from(processingStat)
    .where(trendClauses.length > 0 ? and(...trendClauses) : undefined)
    .groupBy(monthExpr);

  const monthlyTrend: MonthlyStat[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const found = trendRows.find((r) => r.month === key);
    monthlyTrend.push({ month: key, count: found?.count ?? 0, totalBytes: found?.total ?? 0 });
  }

  const [allTime, thisMonth, thisQuarter] = await Promise.all([
    periodStats(null),
    periodStats(startOfMonth(now)),
    periodStats(startOfQuarter(now)),
  ]);

  return { allTime, thisMonth, thisQuarter, monthlyTrend };
}
