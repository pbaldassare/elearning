import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Card } from './ui';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Home from './pages/Home';

function Layout() {
  const { session, who, loading, signOut, stopImpersonation } = useAuth();
  const { pathname } = useLocation();

  if (loading) return null;
  if (!session) return <Navigate to="/accedi" replace />;
  if (!who) {
    return (
      <Card title="Account non configurato">
        <p className="mb-4">Il tuo account non ha ancora un profilo attivo. Contatta l'amministratore.</p>
        <button className="underline" onClick={signOut}>Esci</button>
      </Card>
    );
  }
  if (who.force_password_change && pathname !== '/profilo') return <Navigate to="/profilo" replace />;

  return (
    <>
      {who.impersonating && (
        <div className="flex items-center justify-between gap-2 bg-ink px-4 py-2 text-sm text-white">
          <span>Stai vedendo la piattaforma come {who.profile.first_name} {who.profile.last_name}.</span>
          <button className="rounded bg-white/15 px-3 py-1 hover:bg-white/25" onClick={stopImpersonation}>
            Esci da impersonificazione
          </button>
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold">D-Academy</Link>
          <div className="flex gap-4 text-sm">
            <Link to="/profilo">Profilo</Link>
            <button onClick={signOut}>Esci</button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/accedi" element={<Login />} />
      <Route path="/password-dimenticata" element={<ForgotPassword />} />
      <Route path="/reimposta-password" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/profilo" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
