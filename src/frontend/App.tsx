import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import AppShell from "./pages/AppShell";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import { LegalPlaceholder } from "./pages/legal/LegalPlaceholder";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route path="/legal/impressum" element={<LegalPlaceholder title="Impressum" />} />
      <Route path="/legal/datenschutz" element={<LegalPlaceholder title="Datenschutzerklärung" />} />
      <Route path="/legal/terms" element={<LegalPlaceholder title="Terms" />} />
    </Routes>
  );
}
