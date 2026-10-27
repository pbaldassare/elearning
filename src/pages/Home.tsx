import { useAuth } from '../auth';

// Dashboard per ruolo: i contenuti arrivano in fase 2.
const titles = { admin: 'Pannello Admin', azienda: 'Pannello Azienda', corsista: 'I miei corsi' };

export default function Home() {
  const { who } = useAuth();
  if (!who) return null;
  return (
    <section>
      <h1 className="text-2xl font-semibold">{titles[who.profile.role]}</h1>
      <p className="mt-2 text-slate-600">Benvenuto, {who.profile.first_name}.</p>
    </section>
  );
}
