import { Layout } from "../../components/Layout";

export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <Layout>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          TODO: placeholder only — this text has not been drafted or reviewed
          by a lawyer and must not be used in production. Replace before
          launch.
        </div>
      </section>
    </Layout>
  );
}
