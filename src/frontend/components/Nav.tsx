import { Link } from "react-router-dom";
import { useSession, signOut } from "../lib/auth-client";

export function Nav() {
  const { data: session } = useSession();

  return (
    <header className="border-b border-slate-200">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-semibold text-slate-900">
          SENtoArc
        </Link>
        <div className="flex items-center gap-6 text-sm text-slate-600">
          <Link to="/pricing">Pricing</Link>
          {session ? (
            <>
              <Link to="/app">App</Link>
              <Link to="/account">Account</Link>
              <button onClick={() => signOut()} className="text-slate-900">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/sign-in">Sign in</Link>
              <Link
                to="/sign-up"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-white"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
