import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";
import { button, card, input as inputClass } from "../lib/ui";

export default function Landing() {
  return (
    <Layout>
      <Hero />
      <Problem />
      <HowItWorks />
      <PricingTeaser />
      <Faq />
      <Contact />
    </Layout>
  );
}

function Hero() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl px-6 py-20 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        {t("landing.hero.titleLine1")}
        <span className="text-slate-500"> {t("landing.hero.titleLine2")}</span>
      </h1>
      <p className="mt-6 text-lg text-slate-600">{t("landing.hero.body")}</p>
      <div className="mt-8 flex justify-center gap-4">
        <Link to="/sign-up" className={button("primary", "lg")}>
          {t("landing.hero.tryFree")}
        </Link>
        <Link to="/pricing" className={button("secondary", "lg")}>
          {t("landing.hero.seePricing")}
        </Link>
      </div>
    </section>
  );
}

function Problem() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{t("landing.problem.title")}</h2>
      <p className="mt-4 text-slate-600">
        {t("landing.problem.body1Prefix")}
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-sm">asset</code>
        {t("landing.problem.body1Middle")}
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-sm">sco</code>
        {t("landing.problem.body1Suffix")}
      </p>
      <p className="mt-4 text-slate-600">{t("landing.problem.body2")}</p>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const steps = t("landing.howItWorks.steps", { returnObjects: true }) as { title: string; body: string }[];
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{t("landing.howItWorks.title")}</h2>
      <ol className="mt-6 grid gap-6 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.title} className={card("transition-shadow hover:shadow-md")}>
            <span className="text-sm font-medium text-slate-400">{t("landing.howItWorks.stepLabel", { number: i + 1 })}</span>
            <h3 className="mt-1 font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PricingTeaser() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl px-6 py-12 text-center">
      <h2 className="text-2xl font-semibold text-slate-900">{t("landing.pricingTeaser.title")}</h2>
      <p className="mt-4 text-slate-600">{t("landing.pricingTeaser.body")}</p>
      <Link to="/pricing" className="mt-6 inline-block text-slate-900 underline transition-colors hover:text-slate-600">
        {t("landing.pricingTeaser.link")}
      </Link>
    </section>
  );
}

function Faq() {
  const { t } = useTranslation();
  const items = t("landing.faq.items", { returnObjects: true }) as { q: string; a: string }[];
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{t("landing.faq.title")}</h2>
      <dl className="mt-6 space-y-6">
        {items.map((item) => (
          <div key={item.q}>
            <dt className="font-medium text-slate-900">{item.q}</dt>
            <dd className="mt-1 text-sm text-slate-600">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Contact() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("sending");
    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.get("companyName"),
          contactName: form.get("contactName"),
          email: form.get("email"),
          companySize: form.get("companySize"),
          message: form.get("message"),
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{t("landing.contact.title")}</h2>
      <p className="mt-4 text-slate-600">{t("landing.contact.body")}</p>
      {status === "sent" ? (
        <p className="mt-6 rounded-md bg-green-50 p-4 text-green-800">{t("landing.contact.thanks")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input name="companyName" required placeholder={t("landing.contact.companyNamePlaceholder")} className={inputClass()} />
          <input name="contactName" required placeholder={t("landing.contact.contactNamePlaceholder")} className={inputClass()} />
          <input name="email" required type="email" placeholder={t("landing.contact.emailPlaceholder")} className={inputClass()} />
          <input name="companySize" placeholder={t("landing.contact.companySizePlaceholder")} className={inputClass()} />
          <textarea name="message" placeholder={t("landing.contact.messagePlaceholder")} className={inputClass()} rows={3} />
          <button type="submit" disabled={status === "sending"} className={button("primary", "lg")}>
            {status === "sending" ? t("landing.contact.sending") : t("landing.contact.submit")}
          </button>
          {status === "error" && <p className="text-sm text-red-600">{t("landing.contact.error")}</p>}
        </form>
      )}
    </section>
  );
}
