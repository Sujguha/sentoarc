import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession, signOut } from "../lib/auth-client";
import { button } from "../lib/ui";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors ${isActive ? "font-medium text-slate-900" : "text-slate-600 hover:text-slate-900"}`;

export function Nav() {
  const { data: session } = useSession();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
            S
          </span>
          SENtoArc
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <NavLink to="/pricing" className={navLinkClass}>
            {t("nav.pricing")}
          </NavLink>
          {session ? (
            <>
              <NavLink to="/app" className={navLinkClass}>
                {t("nav.app")}
              </NavLink>
              <NavLink to="/organization" className={navLinkClass}>
                {t("nav.organization")}
              </NavLink>
              <NavLink to="/account" className={navLinkClass}>
                {t("nav.account")}
              </NavLink>
              <button onClick={() => signOut()} className={button("secondary", "sm")}>
                {t("nav.signOut")}
              </button>
            </>
          ) : (
            <>
              <NavLink to="/sign-in" className={navLinkClass}>
                {t("nav.signIn")}
              </NavLink>
              <Link to="/sign-up" className={button("primary", "sm")}>
                {t("nav.getStarted")}
              </Link>
            </>
          )}
          <LanguageSwitcher />
        </div>
      </nav>
    </header>
  );
}
