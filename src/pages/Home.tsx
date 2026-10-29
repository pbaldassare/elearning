import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { downloadCertificate, supabase } from '../lib/supabase';
import { useRows } from '../lib/useRows';
import { Badge, btn, Empty, EnrollmentBadge, fmtDate, PageTitle, Panel, Progress, type Enrollment } from '../ui';
import Courses from './admin/Courses';

const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

function MyCourses() {
  const { who } = useAuth();
  const list = useRows<Enrollment>(() =>
    supabase.from('enrollments').select('*, courses(title, required_hours)')
      .eq('user_id', who!.profile.id).order('assigned_at', { ascending: false }));
  return (
    <>
      <PageTitle title="I miei corsi" sub={`Ciao ${who!.profile.first_name}, qui trovi i corsi assegnati e le scadenze.`} />
      {list.rows?.length === 0 && <Panel><Empty>Non hai ancora corsi assegnati.</Empty></Panel>}
      <div className="grid gap-4 md:grid-cols-2">
        {list.rows?.map((e) => {
          const left = daysLeft(e.expires_at);
          return (
            <Panel key={e.id}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{e.courses?.title}</h2>
                <EnrollmentBadge e={e} />
              </div>
              <Progress e={e} />
              <p className="mt-3 text-sm">
                Da completare entro il <strong>{fmtDate(e.expires_at)}</strong>
                {e.status !== 'completato' && left >= 0 && left <= 5 && <> · <Badge tone="warn">{left === 0 ? 'scade oggi' : `mancano ${left} giorni`}</Badge></>}
              </p>
              <Link to={`/corso/${e.id}`} className="mt-4 block rounded-lg bg-brand-strong px-4 py-2 text-center font-medium text-on-brand hover:brightness-110">
                {e.status === 'assegnato' ? 'Inizia il corso' : 'Apri il corso'}
              </Link>
              {e.status === 'completato' && (
                <button className={`${btn.ghost} mt-2 w-full py-2`}
                        onClick={() => downloadCertificate(e.id, `attestato-${e.courses?.title ?? 'corso'}`).catch((err) => alert(err.message))}>
                  Scarica l’attestato
                </button>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

type CompanyCourse = {
  id: string; title: string; required_hours: number; expiry_days: number;
  enrollments: Pick<Enrollment, 'status' | 'expires_at'>[];
};

function CompanyHome() {
  const list = useRows<CompanyCourse>(() =>
    supabase.from('courses').select('id, title, required_hours, expiry_days, enrollments(status, expires_at)').order('title'));
  return (
    <>
      <PageTitle title="Corsi assegnati" sub="I corsi che puoi assegnare ai tuoi corsisti, con il loro stato." />
      {list.rows?.length === 0 && <Panel><Empty>Nessun corso assegnato alla tua azienda.</Empty></Panel>}
      <div className="grid gap-4 md:grid-cols-2">
        {list.rows?.map((c) => {
          const done = c.enrollments.filter((e) => e.status === 'completato').length;
          const expired = c.enrollments.filter((e) => e.status !== 'completato' && new Date(e.expires_at) < new Date()).length;
          return (
            <Panel key={c.id}>
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="mb-4 text-sm text-ink-muted">{c.required_hours} ore · da completare in {c.expiry_days} giorni dall’assegnazione</p>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[['Assegnati', c.enrollments.length], ['Completati', done], ['Scaduti', expired]].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-surface p-3">
                    <dd className="text-2xl font-bold">{v}</dd><dt className="text-xs text-ink-muted">{l}</dt>
                  </div>
                ))}
              </dl>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

export default function Home() {
  const { who } = useAuth();
  if (!who) return null;
  const role = who.profile.role;
  return role === 'admin' ? <Courses /> : role === 'azienda' ? <CompanyHome /> : <MyCourses />;
}
