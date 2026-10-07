import { card } from "../lib/ui";

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
  monthlyTrend: MonthlyStat[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : value < 10 ? 1 : 0)} ${units[i]}`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

function StatTile({ label, stats, delta }: { label: string; stats: PeriodStats; delta?: number | null }) {
  return (
    <div className={card()}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{stats.count.toLocaleString()}</span>
        {delta !== undefined && delta !== null && (
          <span className={`text-xs font-medium ${delta >= 0 ? "text-green-700" : "text-red-700"}`}>
            {delta >= 0 ? "+" : ""}
            {delta}% vs last month
          </span>
        )}
      </p>
      <p className="text-xs text-slate-500">documents processed</p>
      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
        <p>
          Total size: <span className="font-medium text-slate-900">{formatBytes(stats.totalBytes)}</span>
        </p>
        <p>
          Average size: <span className="font-medium text-slate-900">{formatBytes(stats.avgBytes)}</span>
        </p>
      </div>
    </div>
  );
}

const CHART_HEIGHT_PX = 96;
const BAR_WIDTH_PX = 24;

function TrendChart({ monthlyTrend }: { monthlyTrend: MonthlyStat[] }) {
  const max = Math.max(1, ...monthlyTrend.map((m) => m.count));

  return (
    <div className={card()}>
      <p className="text-sm font-medium text-slate-900">Documents processed per month</p>
      <div className="mt-4 flex items-end justify-between gap-2" style={{ height: CHART_HEIGHT_PX + 20 }}>
        {monthlyTrend.map((m) => {
          const barHeight = m.count > 0 ? Math.max(2, Math.round((m.count / max) * CHART_HEIGHT_PX)) : 0;
          return (
            <div key={m.month} className="flex flex-1 flex-col items-center">
              <span className="text-xs text-slate-500">{m.count > 0 ? m.count : ""}</span>
              <div className="group relative mt-1 flex items-end" style={{ height: CHART_HEIGHT_PX }}>
                <div
                  tabIndex={0}
                  className="rounded-t bg-slate-900 outline-none transition-colors hover:bg-slate-700 focus:bg-slate-700"
                  style={{ width: BAR_WIDTH_PX, height: barHeight }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white group-hover:block group-focus-within:block">
                  <strong>{m.count.toLocaleString()}</strong> processed · {formatBytes(m.totalBytes)} total
                </div>
              </div>
              <span className="mt-1 text-xs text-slate-400">{monthLabel(m.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatsPanel({ stats }: { stats: ProcessingStats }) {
  const trend = stats.monthlyTrend;
  const current = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  const delta = previous && previous.count > 0 && current ? Math.round(((current.count - previous.count) / previous.count) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="All time" stats={stats.allTime} />
        <StatTile label="This month" stats={stats.thisMonth} delta={delta} />
        <StatTile label="This quarter" stats={stats.thisQuarter} />
      </div>
      <TrendChart monthlyTrend={trend} />
    </div>
  );
}
