import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

const LANGUAGE_LABELS: Record<(typeof SUPPORTED_LANGUAGES)[number], string> = {
  en: "EN",
  de: "DE",
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = SUPPORTED_LANGUAGES.includes(i18n.language as (typeof SUPPORTED_LANGUAGES)[number])
    ? (i18n.language as (typeof SUPPORTED_LANGUAGES)[number])
    : "en";

  return (
    <div className="flex items-center gap-1 text-xs">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => i18n.changeLanguage(lang)}
          aria-pressed={current === lang}
          className={`rounded px-1.5 py-0.5 transition-colors ${
            current === lang ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {LANGUAGE_LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
