import { Layout } from "../components/Layout";

export default function AppShell() {
  return (
    <Layout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Upload a package</h1>
        <p className="mt-4 text-slate-600">
          Upload, validation, auto-fix, and the migration report land in
          Phase 2. This page exists so sign-in → authenticated app routing
          is wired end to end before that work starts.
        </p>
      </section>
    </Layout>
  );
}
