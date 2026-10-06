import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { authClient, useSession } from "../lib/auth-client";

interface InvitationDetail {
  organizationName: string;
  email: string;
  role: string;
}

export default function AcceptInvitation() {
  const { data: session, isPending: sessionPending } = useSession();
  const navigate = useNavigate();
  const invitationId = new URLSearchParams(window.location.search).get("id");

  const [invitation, setInvitation] = useState<InvitationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!invitationId) {
      setError("This invitation link is missing its invitation ID.");
      return;
    }
    authClient.organization.getInvitation({ query: { id: invitationId } }).then(({ data, error: err }) => {
      if (err || !data) {
        setError("This invitation doesn't exist anymore, or has already been used.");
        return;
      }
      setInvitation(data as unknown as InvitationDetail);
    });
  }, [invitationId]);

  async function accept() {
    if (!invitationId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.acceptInvitation({ invitationId });
    if (err) {
      setError(err.message ?? "Couldn't accept the invitation.");
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
        <h1 className="text-2xl font-bold text-slate-900">Organization invitation</h1>

        {!sessionPending && !session && (
          <p className="mt-4 text-sm text-slate-600">
            Sign in to accept this invitation:{" "}
            <Link to={`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="text-indigo-700 underline">
              sign in
            </Link>
            .
          </p>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {done && <p className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">You've joined the team — redirecting…</p>}

        {!error && !done && invitation && session && (
          <div className="mt-6 rounded-lg border border-slate-200 p-6">
            <p className="text-slate-700">
              You've been invited to join <strong>{invitation.organizationName}</strong> as {invitation.role}.
            </p>
            <button
              onClick={accept}
              disabled={busy}
              className="mt-4 rounded-md bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Joining…" : "Accept invitation"}
            </button>
          </div>
        )}
      </section>
    </Layout>
  );
}
