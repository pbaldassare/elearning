import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, type Role } from './auth';
import { Card, Logo } from './ui';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Home from './pages/Home';
import People from './pages/People';
import Content from './pages/admin/Content';
import Companies from './pages/admin/Companies';
import Audit from './pages/admin/Audit';
import Player from './player/Player';
import Quiz from './player/Quiz';
import Questions from './pages/admin/Questions';

const nav: Record<Role, [string, string][]> = {
  admin: [['/', 'Corsi'], ['/contenuti', 'Contenuti'], ['/domande', 'Domande'], ['/aziende', 'Aziende'], ['/corsisti', 'Corsisti'], ['/registro', 'Registro']],
  azienda: [['/', 'Corsi'], ['/corsisti', 'Corsisti']],
  corsista: [['/', 'I miei corsi']],
};

// Pagina riservata a certi ruoli (effettivi): la RLS protegge comunque i dati.
function Only({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { who } = useAuth();
  return who && roles.includes(who.profile.role) ? children : <Navigate to="/" replace />;
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 font-medium ${isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:text-ink'}`;

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
        <div className="flex flex-wrap items-center justify-between gap-2 bg-ink px-4 py-2 text-sm text-white">
          <span>Stai vedendo la piattaforma come {who.profile.first_name} {who.profile.last_name}.</span>
          <button className="rounded bg-white/15 px-3 py-1 hover:bg-white/25" onClick={stopImpersonation}>
            Esci da impersonificazione
          </button>
        </div>
      )}
      <header className="border-b border-line bg-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" aria-label="D-Academy, home"><Logo /></Link>
          <div className="order-last flex w-full flex-wrap gap-1 text-sm sm:order-none sm:w-auto">
            {nav[who.profile.role].map(([to, label]) => <NavLink key={to} to={to} end className={linkCls}>{label}</NavLink>)}
          </div>
          <div className="ml-auto flex gap-1 text-sm">
            <NavLink to="/profilo" className={linkCls}>Profilo</NavLink>
            <button className="rounded-lg px-3 py-1.5 font-medium text-ink-muted hover:text-ink" onClick={signOut}>Esci</button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
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
        <Route path="/corso/:id" element={<Only roles={['corsista']}><Player /></Only>} />
        <Route path="/corso/:id/test" element={<Only roles={['corsista']}><Quiz /></Only>} />
        <Route path="/domande" element={<Only roles={['admin']}><Questions /></Only>} />
        <Route path="/corsisti" element={<Only roles={['admin', 'azienda']}><People /></Only>} />
        <Route path="/contenuti" element={<Only roles={['admin']}><Content /></Only>} />
        <Route path="/aziende" element={<Only roles={['admin']}><Companies /></Only>} />
        <Route path="/registro" element={<Only roles={['admin']}><Audit /></Only>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
