import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { PasswordInput } from "../components/PasswordInput";
import { authClient } from "../lib/auth-client";

export default function SignUp() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const { error: signUpError } = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Sign up failed");
      return;
    }
    navigate("/app");
  }

  return (
    <Layout>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input name="name" required placeholder="Name" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="email" required type="email" placeholder="Work email" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <PasswordInput name="password" required minLength={8} placeholder="Password" />
          <button type="submit" disabled={submitting} className="w-full rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {submitting ? "Creating account…" : "Sign up"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already have an account? <Link to="/sign-in" className="underline">Sign in</Link>
        </p>
      </section>
    </Layout>
  );
}
