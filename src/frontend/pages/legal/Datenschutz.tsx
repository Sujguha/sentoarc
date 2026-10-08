import { Layout } from "../../components/Layout";
import { DraftBanner } from "./DraftBanner";

export default function Datenschutz() {
  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-slate-700">
        <h1 className="text-2xl font-bold text-slate-900">Datenschutzerklärung</h1>
        <DraftBanner />

        <h2 className="mt-6 font-semibold text-slate-900">1. Controller</h2>
        <p className="mb-4">
          Sujoy Guha Consulting, Situlistraße 35, 80939 München, Deutschland — contact for privacy matters:
          sujoy.guha@mnet-mail.de.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">2. What data we process</h2>
        <ul className="mb-4 list-disc space-y-1 pl-5">
          <li>Account data: name, email address, password hash (for password accounts).</li>
          <li>
            Uploaded files: the SCORM packages you upload are stored only for the retention period of your
            plan (Free: 24 hours; Pro: 30 days; Enterprise: configurable by your organization admin), then
            automatically deleted.
          </li>
          <li>Usage and billing data: plan tier, upload counts, and (for paid plans) subscription/billing status.</li>
          <li>
            Contact-sales form submissions: company name, your name, email, company size, and any message you
            provide.
          </li>
          <li>
            Technical and log data: metadata only (timestamps, status codes, error categories) — we do not log
            the content of your training materials.
          </li>
        </ul>

        <h2 className="mt-6 font-semibold text-slate-900">3. Purposes and legal basis</h2>
        <p className="mb-4">
          We process this data to provide the service you've signed up for (Art. 6(1)(b) GDPR — performance of
          a contract), to secure the service against abuse (Art. 6(1)(f) — legitimate interest), and, where
          applicable, to meet invoicing and tax obligations (Art. 6(1)(c) — legal obligation).
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">4. Who we share data with</h2>
        <p className="mb-4">We use the following processors, each bound by a data processing agreement:</p>
        <ul className="mb-4 list-disc space-y-1 pl-5">
          <li>Cloudflare, Inc. — hosting, database, and file storage. Uploaded/fixed files are stored in R2 under Cloudflare's EU jurisdiction.</li>
          <li>Twilio SendGrid — transactional email (account verification, sign-in links).</li>
          <li>Stripe, Inc. — payment processing for paid plans.</li>
        </ul>
        <p className="mb-4">
          Some of these processors operate outside the EU/EEA for parts of their infrastructure (e.g. email
          delivery, payment processing); where that applies, transfers rely on Standard Contractual Clauses or
          another valid transfer mechanism. [Confirm and link each processor's current DPA/SCC terms here.]
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">5. Retention</h2>
        <p className="mb-4">
          Uploaded and fixed files are deleted automatically per the retention periods above. Account data is
          kept for as long as your account is active, and deleted (along with all associated files) when you
          delete your account.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">6. Your rights</h2>
        <p className="mb-4">
          Under the GDPR you have the right to access, rectify, erase, or restrict processing of your personal
          data, to data portability, and to object to processing based on legitimate interest. You can delete
          your account and all associated data yourself from your account settings, or contact us at
          sujoy.guha@mnet-mail.de. You also have the right to lodge a complaint with your local data protection
          supervisory authority.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">7. Cookies</h2>
        <p className="mb-4">
          We use only a strictly necessary session cookie to keep you signed in. We do not use analytics,
          advertising, or tracking cookies, so no cookie consent banner is shown.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">8. Changes to this policy</h2>
        <p>We may update this policy as the service evolves; the current version always applies.</p>
      </section>
    </Layout>
  );
}
