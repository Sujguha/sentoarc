import { Layout } from "../../components/Layout";
import { DraftBanner } from "./DraftBanner";

export default function Impressum() {
  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-slate-700">
        <h1 className="text-2xl font-bold text-slate-900">Impressum</h1>
        <DraftBanner />

        <p className="mb-4">Angaben gemäß § 5 TMG:</p>

        <p className="mb-4">
          Sujoy Guha Consulting
          <br />
          Situlistraße 35
          <br />
          80939 München
          <br />
          Deutschland
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">Kontakt</h2>
        <p className="mb-4">
          E-Mail: [your-contact-email]
          <br />
          Telefon: [optional — phone number]
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">Umsatzsteuer-ID</h2>
        <p className="mb-4">
          [Your VAT identification number per § 27a UStG — not yet issued; omit this section until you have one]
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p className="mb-4">
          Sujoy Guha Consulting
          <br />
          Situlistraße 35
          <br />
          80939 München
          <br />
          Deutschland
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">Streitschlichtung</h2>
        <p className="mb-4">
          [State here whether you participate in consumer dispute resolution proceedings before a consumer
          arbitration board, and reference the current EU/national dispute-resolution information requirement
          applicable at the time this page goes live — verify the exact wording required, since this has
          changed over time.]
        </p>

        <h2 className="mt-6 font-semibold text-slate-900">Haftungshinweis</h2>
        <p>
          SENtoArc works with content exported from SAP Enable Now and prepares it for import into WalkMe
          Learning Arc. SENtoArc is not affiliated with, endorsed by, or sponsored by SAP SE or WalkMe Inc. SAP,
          SAP Enable Now, WalkMe, and WalkMe Learning Arc are trademarks of their respective owners.
        </p>
      </section>
    </Layout>
  );
}
