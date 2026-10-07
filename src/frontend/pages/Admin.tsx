import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { StatsPanel, type ProcessingStats } from "../components/StatsPanel";

export default function Admin() {
  const [status, setStatus] = useState<"checking" | "authorized" | "forbidden">("checking");
  const [stats, setStats] = useState<ProcessingStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/ping")
      .then((res) => setStatus(res.ok ? "authorized" : "forbidden"))
      .catch(() => setStatus("forbidden"));
  }, []);

  useEffect(() => {
    if (status !== "authorized") return;
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStats(data as ProcessingStats | null))
      .catch(() => setStats(null));
  }, [status]);

  return (
    <Layout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        {status === "checking" && <p className="mt-4 text-slate-600">Checking access…</p>}
        {status === "forbidden" && (
          <p className="mt-4 text-red-600">
            Not authorized — this page is restricted to the operator's allowlisted account.
          </p>
        )}
        {status === "authorized" && (
          <>
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-slate-900">Platform-wide processing</h2>
              <p className="mt-1 text-sm text-slate-500">Across every user and organization, every tier.</p>
              <div className="mt-3">{stats && <StatsPanel stats={stats} />}</div>
            </div>
            <p className="mt-8 text-sm text-slate-500">
              Lead review, plan overrides, and feature-flag controls land in Phase 4.
            </p>
          </>
        )}
      </section>
    </Layout>
  );
}
