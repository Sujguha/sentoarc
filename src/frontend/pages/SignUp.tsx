import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";
import { PasswordInput } from "../components/PasswordInput";
import { Turnstile } from "../components/Turnstile";
import { authClient } from "../lib/auth-client";
import { button, input as inputClass } from "../lib/ui";

export default function SignUp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTurnstileSiteKey((data as { turnstileSiteKey?: string | null } | null)?.turnstileSiteKey ?? null))
      .catch(() => setTurnstileSiteKey(null));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const { error: signUpError } = await authClient.signUp.email(
      {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      captchaToken ? { headers: { "x-captcha-response": captchaToken } } : undefined
    );

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? t("signUp.errorFallback"));
      return;
    }
    navigate("/app");
  }

  return (
    <Layout>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">{t("signUp.title")}</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input name="name" required placeholder={t("signUp.namePlaceholder")} className={inputClass()} />
          <input name="email" required type="email" placeholder={t("signUp.emailPlaceholder")} className={inputClass()} />
          <PasswordInput name="password" required minLength={8} placeholder={t("signIn.tabPassword")} />
          {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onVerify={setCaptchaToken} />}
          <button
            type="submit"
            disabled={submitting || (turnstileSiteKey !== null && !captchaToken)}
            className={`w-full ${button("primary", "md")}`}
          >
            {submitting ? t("signUp.submitting") : t("signUp.submit")}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <p className="mt-4 text-sm text-slate-500">
          {t("signUp.haveAccount")}{" "}
          <Link to="/sign-in" className="underline transition-colors hover:text-slate-700">
            {t("signUp.signInLink")}
          </Link>
        </p>
      </section>
    </Layout>
  );
}
