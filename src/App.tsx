import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, type Role } from './auth';
import { btn, Card, Logo, ThemeToggle } from './ui';
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
import Reports from './pages/Reports';

const nav: Record<Role, [string, string][]> = {
  admin: [['/', 'Corsi'], ['/contenuti', 'Contenuti'], ['/domande', 'Domande'], ['/aziende', 'Aziende'], ['/corsisti', 'Corsisti'], ['/report', 'Report'], ['/registro', 'Registro']],
  azienda: [['/', 'Corsi'], ['/corsisti', 'Corsisti'], ['/report', 'Report']],
  corsista: [['/', 'I miei corsi']],
};

// Pagina riservata a certi ruoli (effettivi): la RLS protegge comunque i dati.
function Only({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { who } = useAuth();
  return who && roles.includes(who.profile.role) ? children : <Navigate to="/" replace />;
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 font-medium ${isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:text-ink'}`;

function Layout() {
  const { session, who, loading, signOut, stopImpersonation } = useAuth();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  // Lezioni e test a schermo pieno: niente barra laterale, il player ha la sua intestazione.
  const focus = pathname.startsWith('/corso/');
  useEffect(() => setMenu(false), [pathname]);

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

  if (focus) {
    return (
      <>
        {who.impersonating && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1f2227] px-4 py-2 text-sm text-white">
            <span>Stai vedendo la piattaforma come {who.profile.first_name} {who.profile.last_name}.</span>
            <button className="rounded bg-white/15 px-3 py-1 hover:bg-white/25" onClick={stopImpersonation}>Esci da impersonificazione</button>
          </div>
        )}
        <main className="px-4 pb-10 lg:px-8"><Outlet /></main>
      </>
    );
  }

  return (
    <div className="lg:flex">
      {/* Barra laterale: fissa da desktop, a scomparsa (pulsante Menu) sul telefono. */}
      <div className="flex items-center justify-between border-b border-line bg-card px-4 py-3 lg:hidden print:hidden">
        <Link to="/" aria-label="D-Academy, home"><Logo /></Link>
        <button className={btn.ghost} aria-expanded={menu} aria-controls="sidebar" onClick={() => setMenu(!menu)}>Menu</button>
      </div>
      {menu && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMenu(false)} aria-hidden />}
      <aside id="sidebar"
             className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-card p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden ${menu ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link to="/" aria-label="D-Academy, home" className="mb-6 px-3"><Logo /></Link>
        <nav className="flex-1 space-y-1 overflow-y-auto text-sm" aria-label="Principale">
          {nav[who.profile.role].map(([to, label]) => <NavLink key={to} to={to} end className={linkCls}>{label}</NavLink>)}
        </nav>
        <div className="space-y-1 border-t border-line pt-3 text-sm">
          <p className="truncate px-3 pb-1 text-ink-muted">{who.profile.first_name} {who.profile.last_name}</p>
          <NavLink to="/profilo" className={linkCls}>Profilo</NavLink>
          <ThemeToggle className="block w-full rounded-lg px-3 py-2 text-left font-medium text-ink-muted hover:text-ink" />
          <button className="block w-full rounded-lg px-3 py-2 text-left font-medium text-ink-muted hover:text-ink" onClick={signOut}>Esci</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {who.impersonating && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1f2227] px-4 py-2 text-sm text-white print:hidden">
            <span>Stai vedendo la piattaforma come {who.profile.first_name} {who.profile.last_name}.</span>
            <button className="rounded bg-white/15 px-3 py-1 hover:bg-white/25" onClick={stopImpersonation}>
              Esci da impersonificazione
            </button>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
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
        <Route path="/report" element={<Only roles={['admin', 'azienda']}><Reports /></Only>} />
        <Route path="/registro" element={<Only roles={['admin']}><Audit /></Only>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
