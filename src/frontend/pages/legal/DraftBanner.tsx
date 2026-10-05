export function DraftBanner() {
  return (
    <div className="mb-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <strong>Unreviewed draft.</strong> This text was AI-generated as a starting point and has not been
      reviewed by a lawyer. Bracketed fields like{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">[Your legal name]</code> are placeholders, not real
      information, and must be completed before this page is used. Do not treat this as legal advice or as a
      finished, compliant policy.
    </div>
  );
}
