import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";

export default function Admin() {
  const [status, setStatus] = useState<"checking" | "authorized" | "forbidden">("checking");

  useEffect(() => {
    fetch("/api/admin/ping")
      .then((res) => setStatus(res.ok ? "authorized" : "forbidden"))
      .catch(() => setStatus("forbidden"));
  }, []);

  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        {status === "checking" && <p className="mt-4 text-slate-600">Checking access…</p>}
        {status === "forbidden" && (
          <p className="mt-4 text-red-600">
            Not authorized — this page is restricted to the operator's allowlisted account.
          </p>
        )}
        {status === "authorized" && (
          <p className="mt-4 text-slate-600">
            Access confirmed. Lead review, plan overrides, and feature-flag
            controls land in Phase 4.
          </p>
        )}
      </section>
    </Layout>
  );
}
