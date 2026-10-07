import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { PasswordInput } from "../components/PasswordInput";
import { authClient } from "../lib/auth-client";
import { button, input as inputClass } from "../lib/ui";

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
          <input name="name" required placeholder="Name" className={inputClass()} />
          <input name="email" required type="email" placeholder="Work email" className={inputClass()} />
          <PasswordInput name="password" required minLength={8} placeholder="Password" />
          <button type="submit" disabled={submitting} className={`w-full ${button("primary", "md")}`}>
            {submitting ? "Creating account…" : "Sign up"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already have an account?{" "}
          <Link to="/sign-in" className="underline transition-colors hover:text-slate-700">
            Sign in
          </Link>
        </p>
      </section>
    </Layout>
  );
}
