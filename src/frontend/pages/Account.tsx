import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { PasswordInput } from "../components/PasswordInput";
import { StatsPanel, type ProcessingStats } from "../components/StatsPanel";
import { authClient, useSession } from "../lib/auth-client";
import { button, card } from "../lib/ui";

function SectionIcon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-slate-400"
    >
      <path d={path} />
    </svg>
  );
}

const ICON_GEAR =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z";
const ICON_CARD = "M2 7h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M2 7v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7M6 15h4";
const ICON_SHIELD = "M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z";
const ICON_CHART = "M3 3v18h18 M8 17V10 M13 17V6 M18 17v-4";

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
  const [stats, setStats] = useState<ProcessingStats | null>(null);
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
    fetch("/api/usage/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStats(data as ProcessingStats | null))
      .catch(() => setStats(null));
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
      <section className="mx-auto max-w-3xl px-6 py-16">
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
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <SectionIcon path={ICON_GEAR} />
            Account settings
          </h2>
          <div className={`mt-3 ${card()}`}>
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
              <button type="submit" disabled={passwordBusy} className={button("primary", "md")}>
                {passwordBusy ? "Updating…" : "Update password"}
              </button>
              {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
              {passwordSuccess && <p className="text-sm text-green-700">{passwordSuccess}</p>}
            </form>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <SectionIcon path={ICON_CARD} />
            Plans & Pricing
          </h2>
          {usage && (
            <div className={`mt-3 ${card()}`}>
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
                    className={button("primary", "md")}
                  >
                    {billingBusy === "month" ? "Redirecting…" : "Upgrade to Pro (monthly)"}
                  </button>
                  <button
                    onClick={() => startCheckout("year")}
                    disabled={billingBusy !== null}
                    className={button("secondary", "md")}
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
                        className={button("secondary", "md")}
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
                  className={`mt-4 ${button("secondary", "md")}`}
                >
                  {billingBusy === "portal" ? "Redirecting…" : "Manage billing"}
                </button>
              )}

              {billingError && <p className="mt-3 text-sm text-red-600">{billingError}</p>}
            </div>
          )}
        </div>

        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <SectionIcon path={ICON_CHART} />
            Usage stats
          </h2>
          <div className="mt-3">{stats && <StatsPanel stats={stats} />}</div>
        </div>

        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <SectionIcon path={ICON_SHIELD} />
            Privacy & Cookies
          </h2>
          <div className={`mt-3 flex flex-wrap gap-4 text-sm ${card()}`}>
            <Link to="/legal/impressum" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
              Impressum
            </Link>
            <Link to="/legal/datenschutz" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
              Datenschutzerklärung
            </Link>
            <Link to="/legal/terms" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
              Terms
            </Link>
          </div>
        </div>

        <p className="mt-8 text-sm text-slate-500">Account deletion lands in a later phase.</p>
      </section>
    </Layout>
  );
}
