import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { useSession } from "../lib/auth-client";

interface Usage {
  tier: string;
  freeUploadLimit: number;
  freeUploadsUsed: number;
  freeUploadsRemaining: number;
  meteredMbBilledLifetime: number | null;
}

const checkoutParam = new URLSearchParams(window.location.search).get("checkout");

export default function Account() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [billingBusy, setBillingBusy] = useState<"month" | "year" | "metered" | "portal" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data as Usage | null))
      .catch(() => setUsage(null));
  }, []);

  async function startCheckout(selection: { interval: "month" | "year" } | { plan: "metered" }) {
    const busyKey = "plan" in selection ? selection.plan : selection.interval;
    setBillingBusy(busyKey);
    setBillingError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setBillingError(
          body.error === "billing_not_configured"
            ? "That plan isn't available to self-serve yet — check back soon."
            : "Couldn't start checkout — please try again."
        );
        setBillingBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setBillingError("Couldn't start checkout — please try again.");
      setBillingBusy(null);
    }
  }

  async function openBillingPortal() {
    setBillingBusy("portal");
    setBillingError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setBillingError("Couldn't open billing — please try again.");
        setBillingBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setBillingError("Couldn't open billing — please try again.");
      setBillingBusy(null);
    }
  }

  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="mt-2 text-slate-600">{session?.user.email}</p>

        {checkoutParam === "success" && (
          <p className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
            Thanks! Your subscription is being activated — this can take a few seconds to show up below.
          </p>
        )}
        {checkoutParam === "cancelled" && (
          <p className="mt-4 rounded-md bg-slate-50 px-4 py-2 text-sm text-slate-600">Checkout cancelled.</p>
        )}

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
            {usage.tier === "metered" && usage.meteredMbBilledLifetime !== null && (
              <p className="mt-1 text-sm text-slate-600">
                {usage.meteredMbBilledLifetime} MB processed lifetime (€{(usage.meteredMbBilledLifetime * 0.01).toFixed(2)}
                ) — see "Manage billing" for this period's exact charges
              </p>
            )}

            {usage.tier === "free" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => startCheckout({ interval: "month" })}
                  disabled={billingBusy !== null}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {billingBusy === "month" ? "Redirecting…" : "Upgrade to Pro (monthly)"}
                </button>
                <button
                  onClick={() => startCheckout({ interval: "year" })}
                  disabled={billingBusy !== null}
                  className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                >
                  {billingBusy === "year" ? "Redirecting…" : "Upgrade to Pro (yearly)"}
                </button>
                <button
                  onClick={() => startCheckout({ plan: "metered" })}
                  disabled={billingBusy !== null}
                  className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                >
                  {billingBusy === "metered" ? "Redirecting…" : "Start pay-as-you-go"}
                </button>
              </div>
            ) : (
              <button
                onClick={openBillingPortal}
                disabled={billingBusy !== null}
                className="mt-4 rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-900 disabled:opacity-50"
              >
                {billingBusy === "portal" ? "Redirecting…" : "Manage billing"}
              </button>
            )}

            {billingError && <p className="mt-3 text-sm text-red-600">{billingError}</p>}
          </div>
        )}

        <p className="mt-8 text-sm text-slate-500">Account deletion lands in a later phase.</p>
      </section>
    </Layout>
  );
}
