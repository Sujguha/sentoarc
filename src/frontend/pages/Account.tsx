import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useSession } from "../lib/auth-client";

interface Usage {
  tier: string;
  freeUploadLimit: number;
  freeUploadsUsed: number;
  freeUploadsRemaining: number;
}

export default function Account() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data as Usage | null))
      .catch(() => setUsage(null));
  }, []);

  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="mt-2 text-slate-600">{session?.user.email}</p>

        {usage && (
          <div className="mt-6 rounded-lg border border-slate-200 p-5">
            <p className="font-medium text-slate-900">
              Plan: <span className="capitalize">{usage.tier}</span>
            </p>
            {usage.tier === "free" && (
              <p className="mt-1 text-sm text-slate-600">
                {usage.freeUploadsUsed} / {usage.freeUploadLimit} free uploads used
              </p>
            )}
          </div>
        )}

        <p className="mt-8 text-sm text-slate-500">
          Billing (Stripe Checkout / Customer Portal) and account deletion
          land in later phases.
        </p>
      </section>
    </Layout>
  );
}
