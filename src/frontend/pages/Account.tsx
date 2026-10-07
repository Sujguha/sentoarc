import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { PasswordInput } from "../components/PasswordInput";
import { authClient, useSession } from "../lib/auth-client";

interface Usage {
  tier: string;
  freeUploadLimit: number;
  freeUploadsUsed: number;
  freeUploadsRemaining: number;
  balanceCents: number | null;
  meteredMbBilledLifetime: number | null;
}

const TOPUP_PRESETS_CENTS = [500, 1000, 2500];

const checkoutParam = new URLSearchParams(window.location.search).get("checkout");

export default function Account() {
  const { data: session } = useSession();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [billingBusy, setBillingBusy] = useState<"month" | "year" | "portal" | number | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(data as Usage | null))
      .catch(() => setUsage(null));
  }, []);

  async function startCheckout(interval: "month" | "year") {
    setBillingBusy(interval);
    setBillingError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
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

  async function startTopup(amountCents: number) {
    setBillingBusy(amountCents);
    setBillingError(null);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setBillingError("Couldn't start checkout — please try again.");
        setBillingBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setBillingError("Couldn't start checkout — please try again.");
      setBillingBusy(null);
    }
  }

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    setPasswordBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPasswordBusy(false);
    if (error) {
      setPasswordError(error.message ?? "Couldn't update password — please try again.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSuccess("Password updated.");
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
            Thanks! That's being processed — this can take a few seconds to show up below.
          </p>
        )}
        {checkoutParam === "cancelled" && (
          <p className="mt-4 rounded-md bg-slate-50 px-4 py-2 text-sm text-slate-600">Checkout cancelled.</p>
        )}

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Account settings</h2>
          <div className="mt-3 rounded-lg border border-slate-200 p-5">
            <p className="font-medium text-slate-900">Change password</p>
            <form onSubmit={handleChangePassword} className="mt-3 max-w-sm space-y-3">
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Current password"
              />
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="New password"
              />
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Confirm new password"
              />
              <button
                type="submit"
                disabled={passwordBusy}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {passwordBusy ? "Updating…" : "Update password"}
              </button>
              {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
              {passwordSuccess && <p className="text-sm text-green-700">{passwordSuccess}</p>}
            </form>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Plans & Pricing</h2>
          {usage && (
            <div className="mt-3 rounded-lg border border-slate-200 p-5">
              <p className="font-medium text-slate-900">
                Plan: <span className="capitalize">{usage.tier}</span>
              </p>
              {usage.tier === "free" && (
                <p className="mt-1 text-sm text-slate-600">
                  {usage.freeUploadsUsed} / {usage.freeUploadLimit} free uploads used
                </p>
              )}
              {usage.tier === "metered" && usage.balanceCents !== null && (
                <p className="mt-1 text-sm text-slate-600">
                  Balance: <span className="font-medium text-slate-900">€{(usage.balanceCents / 100).toFixed(2)}</span>
                  {usage.meteredMbBilledLifetime !== null && ` · ${usage.meteredMbBilledLifetime} MB processed lifetime`}
                  {" — prepaid, deducted per upload, no subscription"}
                </p>
              )}

              {usage.tier === "free" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => startCheckout("month")}
                    disabled={billingBusy !== null}
                    className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {billingBusy === "month" ? "Redirecting…" : "Upgrade to Pro (monthly)"}
                  </button>
                  <button
                    onClick={() => startCheckout("year")}
                    disabled={billingBusy !== null}
                    className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                  >
                    {billingBusy === "year" ? "Redirecting…" : "Upgrade to Pro (yearly)"}
                  </button>
                </div>
              )}

              {(usage.tier === "free" || usage.tier === "metered") && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-sm text-slate-600">
                    {usage.tier === "free" ? "Or pay as you go — top up a balance, no subscription:" : "Top up your balance:"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TOPUP_PRESETS_CENTS.map((cents) => (
                      <button
                        key={cents}
                        onClick={() => startTopup(cents)}
                        disabled={billingBusy !== null}
                        className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                      >
                        {billingBusy === cents ? "Redirecting…" : `+€${(cents / 100).toFixed(0)}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {usage.tier !== "free" && (
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
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900">Privacy & Cookies</h2>
          <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 p-5 text-sm">
            <Link to="/legal/impressum" className="text-indigo-700 underline">
              Impressum
            </Link>
            <Link to="/legal/datenschutz" className="text-indigo-700 underline">
              Datenschutzerklärung
            </Link>
            <Link to="/legal/terms" className="text-indigo-700 underline">
              Terms
            </Link>
          </div>
        </div>

        <p className="mt-8 text-sm text-slate-500">Account deletion lands in a later phase.</p>
      </section>
    </Layout>
  );
}
