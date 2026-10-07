import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./en.json";
import de from "./de.json";

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // Remembers the choice across visits (localStorage) but never
      // writes a cookie or calls home -- same "per-viewer convenience,
      // never state Claude/the server needs back" rule the rest of the
      // frontend already follows for browser storage.
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "sentoarc-language",
    },
  });

export default i18n;
