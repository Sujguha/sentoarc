import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";
import { authClient, useSession } from "../lib/auth-client";
import { button, card } from "../lib/ui";

interface InvitationDetail {
  organizationName: string;
  email: string;
  role: string;
}

export default function AcceptInvitation() {
  const { t } = useTranslation();
  const { data: session, isPending: sessionPending } = useSession();
  const navigate = useNavigate();
  const invitationId = new URLSearchParams(window.location.search).get("id");

  const [invitation, setInvitation] = useState<InvitationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!invitationId) {
      setError(t("acceptInvitation.missingId"));
      return;
    }
    authClient.organization.getInvitation({ query: { id: invitationId } }).then(({ data, error: err }) => {
      if (err || !data) {
        setError(t("acceptInvitation.notFound"));
        return;
      }
      setInvitation(data as unknown as InvitationDetail);
    });
  }, [invitationId, t]);

  async function accept() {
    if (!invitationId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.acceptInvitation({ invitationId });
    if (err) {
      setError(err.message ?? t("acceptInvitation.acceptFailed"));
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    setTimeout(() => navigate("/app"), 1500);
  }

  return (
    <Layout>
      <section className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-900">{t("acceptInvitation.title")}</h1>

        {!sessionPending && !session && (
          <p className="mt-4 text-sm text-slate-600">
            {t("acceptInvitation.signInPrompt")}{" "}
            <Link
              to={`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              className="text-indigo-700 underline transition-colors hover:text-indigo-900"
            >
              {t("acceptInvitation.signInLink")}
            </Link>
            .
          </p>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {done && <p className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">{t("acceptInvitation.joined")}</p>}

        {!error && !done && invitation && session && (
          <div className={`mt-6 ${card()}`}>
            <p className="text-slate-700">
              {t("acceptInvitation.invitedPrefix")} <strong>{invitation.organizationName}</strong>{" "}
              {t("acceptInvitation.invitedSuffix", { role: invitation.role })}
            </p>
            <button onClick={accept} disabled={busy} className={`mt-4 ${button("primary", "md")}`}>
              {busy ? t("acceptInvitation.joining") : t("acceptInvitation.accept")}
            </button>
          </div>
        )}
      </section>
    </Layout>
  );
}
