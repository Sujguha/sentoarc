import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
        <div className="flex flex-wrap gap-4">
          <Link to="/legal/impressum">Impressum</Link>
          <Link to="/legal/datenschutz">Datenschutzerklärung</Link>
          <Link to="/legal/terms">Terms</Link>
        </div>
        <p className="mt-4 max-w-3xl">
          SENtoArc works with content exported from SAP Enable Now and
          prepares it for import into WalkMe Learning Arc. SENtoArc is not
          affiliated with, endorsed by, or sponsored by SAP SE or WalkMe Inc.
          SAP, SAP Enable Now, WalkMe, and WalkMe Learning Arc are trademarks
          of their respective owners.
        </p>
      </div>
    </footer>
  );
}
