import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

const tiers = [
  {
    name: "Free",
    price: "€0",
    cadence: "",
    description: "Try it on a handful of packages.",
    features: [
      "Up to 5 package uploads total",
      "Single packages only",
      "Fixed ZIP download",
      "On-screen report",
    ],
    cta: { label: "Sign up free", to: "/sign-up" },
  },
  {
    name: "Pro",
    price: "€19",
    cadence: "per user / month, billed monthly or yearly",
    description: "For ongoing migrations.",
    features: [
      "Unlimited uploads",
      "Bulk upload (multiple ZIPs or a ZIP of ZIPs)",
      "CSV report export",
      "Translation-path rewrite",
      "30-day job history",
    ],
    cta: { label: "Start Pro", to: "/sign-up" },
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Contact us",
    cadence: "per company",
    description: "For multiple teams migrating together.",
    features: [
      "Multiple users with roles (admin / editor / viewer)",
      "Shared migration projects",
      "Full audit log",
      "Configurable data retention",
    ],
    cta: { label: "Contact sales", to: "/#contact" },
  },
];

export default function Pricing() {
  return (
    <Layout>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-center text-3xl font-bold text-slate-900">Pricing</h1>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-6 ${
                tier.highlighted ? "border-slate-900 shadow-lg" : "border-slate-200"
              }`}
            >
              <h2 className="text-lg font-semibold text-slate-900">{tier.name}</h2>
              <p className="mt-2 text-2xl font-bold text-slate-900">{tier.price}</p>
              {tier.cadence && <p className="text-sm text-slate-500">{tier.cadence}</p>}
              <p className="mt-3 text-sm text-slate-600">{tier.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to={tier.cta.to}
                className={`mt-6 block rounded-md px-4 py-2 text-center text-sm font-medium ${
                  tier.highlighted
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 text-slate-900"
                }`}
              >
                {tier.cta.label}
              </Link>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
