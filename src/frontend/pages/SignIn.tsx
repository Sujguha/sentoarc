import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { authClient } from "../lib/auth-client";

// Only ever used as a same-origin client-side route (react-router
// navigate / better-auth callbackURL), never as a fetch target or
// external redirect, so a relative-path check is a sufficient guard
// against sending someone off-site via a crafted ?next= value.
const nextParam = new URLSearchParams(window.location.search).get("next");
const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";

export default function SignIn() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"password" | "magic-link">("password");
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Sign in failed");
      return;
    }
    navigate(next);
  }

  async function handleMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const { error: magicLinkError } = await authClient.signIn.magicLink({
      email: String(form.get("email") ?? ""),
      callbackURL: next,
    });

    setSubmitting(false);
    if (magicLinkError) {
      setError(magicLinkError.message ?? "Could not send sign-in link");
      return;
    }
    setMagicLinkSent(true);
  }

  return (
    <Layout>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        <div className="mt-4 flex gap-4 text-sm">
          <button onClick={() => setMode("password")} className={mode === "password" ? "font-semibold text-slate-900" : "text-slate-500"}>
            Password
          </button>
          <button onClick={() => setMode("magic-link")} className={mode === "magic-link" ? "font-semibold text-slate-900" : "text-slate-500"}>
            Email link
          </button>
        </div>

        {mode === "password" ? (
          <form onSubmit={handlePasswordSignIn} className="mt-6 space-y-4">
            <input name="email" required type="email" placeholder="Email" className="w-full rounded-md border border-slate-300 px-3 py-2" />
            <input name="password" required type="password" placeholder="Password" className="w-full rounded-md border border-slate-300 px-3 py-2" />
            <button type="submit" disabled={submitting} className="w-full rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : magicLinkSent ? (
          <p className="mt-6 rounded-md bg-green-50 p-4 text-sm text-green-800">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="mt-6 space-y-4">
            <input name="email" required type="email" placeholder="Email" className="w-full rounded-md border border-slate-300 px-3 py-2" />
            <button type="submit" disabled={submitting} className="w-full rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
              {submitting ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-4 text-sm text-slate-500">
          No account yet? <Link to="/sign-up" className="underline">Sign up</Link>
        </p>
      </section>
    </Layout>
  );
}
