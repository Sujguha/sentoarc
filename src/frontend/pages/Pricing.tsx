import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";
import { button } from "../lib/ui";

const TIER_IDS = ["free", "metered", "pro", "enterprise"] as const;
type TierId = (typeof TIER_IDS)[number];

const TIER_META: Record<TierId, { price: string; to: string; highlighted?: boolean }> = {
  free: { price: "€0", to: "/sign-up" },
  metered: { price: "€0.01", to: "/sign-up" },
  pro: { price: "€19", to: "/sign-up", highlighted: true },
  enterprise: { price: "Contact us", to: "/#contact" },
};

export default function Pricing() {
  const { t } = useTranslation();

  return (
    <Layout>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-center text-3xl font-bold text-slate-900">{t("pricing.title")}</h1>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIER_IDS.map((id) => {
            const meta = TIER_META[id];
            const features = t(`pricing.tiers.${id}.features`, { returnObjects: true }) as string[];
            const cadence = t(`pricing.tiers.${id}.cadence`, { defaultValue: "" });
            const price = t(`pricing.tiers.${id}.price`, { defaultValue: meta.price });
            return (
              <div
                key={id}
                className={`rounded-xl border bg-white p-6 transition-shadow ${
                  meta.highlighted ? "border-slate-900 shadow-lg" : "border-slate-200 shadow-sm hover:shadow-md"
                }`}
              >
                <h2 className="text-lg font-semibold text-slate-900">{t(`pricing.tiers.${id}.name`)}</h2>
                <p className="mt-2 text-2xl font-bold text-slate-900">{price}</p>
                {cadence && <p className="text-sm text-slate-500">{cadence}</p>}
                <p className="mt-3 text-sm text-slate-600">{t(`pricing.tiers.${id}.description`)}</p>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">
                  {features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link to={meta.to} className={`mt-6 w-full ${button(meta.highlighted ? "primary" : "secondary", "md")}`}>
                  {t(`pricing.tiers.${id}.cta`)}
                </Link>
              </div>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}
