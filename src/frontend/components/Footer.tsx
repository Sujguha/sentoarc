import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
        <div className="flex flex-wrap gap-4">
          <Link to="/legal/impressum" className="transition-colors hover:text-slate-700">
            {t("footer.impressum")}
          </Link>
          <Link to="/legal/datenschutz" className="transition-colors hover:text-slate-700">
            {t("footer.datenschutz")}
          </Link>
          <Link to="/legal/terms" className="transition-colors hover:text-slate-700">
            {t("footer.terms")}
          </Link>
        </div>
        <p className="mt-4 max-w-3xl">{t("footer.disclaimer")}</p>
      </div>
    </footer>
  );
}
