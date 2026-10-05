import { Layout } from "../../components/Layout";
import { DraftBanner } from "./DraftBanner";

export default function Terms() {
  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-slate-700">
        <h1 className="text-2xl font-bold text-slate-900">Terms</h1>
        <DraftBanner />

        <h2 className="mt-6 font-semibold text-slate-900">1. The service</h2>
        <p className="mb-4">
          SENtoArc ("we", "us") validates SCORM packages exported from SAP Enable Now and applies safe automatic
          fixes to help them import into WalkMe Learning Arc. SENtoArc is not affiliated with, endorsed by, or
          sponsored by SAP SE or WalkMe Inc. The service is provided on a best-effort basis: not every package
          can be automatically fixed, and we make no guarantee that a fixed package will import successfully
          into WalkMe Learning Arc, since that depends on WalkMe's own import behavior, which is outside our
          control.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">2. Accounts and plans</h2>
        <p className="mb-4">
          You need an account to use the service. Current plans and their limits are described on our{" "}
          <a href="/pricing" className="underline">
            pricing page
          </a>
          , which may change from time to time. You're responsible for keeping your account credentials secure.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">3. Your content</h2>
        <p className="mb-4">
          You retain all rights to the content you upload. You grant us a limited license to process it solely
          to provide the validation and fixing service, and only for the retention period described in our{" "}
          <a href="/legal/datenschutz" className="underline">
            Datenschutzerklärung
          </a>
          . You're responsible for having the right to upload and process the content you submit.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">4. Acceptable use</h2>
        <p className="mb-4">
          Don't use the service to upload unlawful content, attempt to circumvent plan limits or security
          controls, or interfere with the service's operation for other users.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">5. Availability and liability</h2>
        <p className="mb-4">
          The service is provided "as is," without uptime guarantees for Free or Pro plans [Enterprise customers
          may have separate contractual terms]. To the extent permitted by law, our liability is limited to
          [define a liability cap/exclusion appropriate for your jurisdiction and risk tolerance — this needs
          legal input].
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">6. Termination</h2>
        <p className="mb-4">
          You can delete your account at any time from your account settings, which removes your data per our{" "}
          <a href="/legal/datenschutz" className="underline">
            Datenschutzerklärung
          </a>
          . We may suspend or terminate accounts that violate these terms.
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">7. Changes</h2>
        <p className="mb-4">We may update these terms as the service evolves; continued use after a change means you accept the update.</p>

        <h2 className="mt-6 font-semibold text-slate-900">8. Governing law</h2>
        <p>[State the governing law and jurisdiction applicable to your business — typically Germany/EU given your base, but confirm with a lawyer.]</p>
      </section>
    </Layout>
  );
}
