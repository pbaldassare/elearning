import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { callFn, supabase } from '../lib/supabase';
import { useRows } from '../lib/useRows';
import {
  Badge, btn, Empty, EnrollmentBadge, Field, fmtDate, inputCls, Message, PageTitle, Panel, Progress, Select,
  type Enrollment,
} from '../ui';

type Person = {
  id: string; first_name: string; last_name: string; email: string; codice_fiscale: string;
  company_id: string; is_demo: boolean; companies: { name: string } | null; enrollments: Enrollment[];
};

// Corsisti e assegnazioni. Admin: tutte le aziende. Azienda: solo i propri (lo garantisce la RLS).
export default function People() {
  const { who, startImpersonation } = useAuth();
  const navigate = useNavigate();
  const isAdmin = who?.profile.role === 'admin';
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const people = useRows<Person>(() => {
    let query = supabase.from('profiles')
      .select('id, first_name, last_name, email, codice_fiscale, company_id, is_demo, companies(name), enrollments(*, courses(title, required_hours))')
      .eq('role', 'corsista').order('last_name');
    if (company) query = query.eq('company_id', company);
    return query;
  }, [company]);
  const companies = useRows<{ id: string; name: string }>(() =>
    isAdmin ? supabase.from('companies').select('id, name').is('archived_at', null).order('name') : Promise.resolve({ data: [], error: null }), [isAdmin]);
  const courses = useRows<{ id: string; title: string }>(() =>
    supabase.from('courses').select('id, title').eq('status', 'attivo').order('title'));
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const report = (error: { message: string } | null, ok: string) => {
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: ok });
    if (!error) people.reload();
    return !error;
  };

  const addPerson = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    try {
      await callFn('create-user', { ...f, role: 'corsista', is_demo: f.is_demo === 'on' });
      form.reset();
      report(null, 'Corsista creato con la password standard.');
    } catch (err) {
      report({ message: (err as Error).message }, '');
    }
  };

  const assign = async (p: Person, courseId: string) => {
    const { error } = await supabase.from('enrollments').insert({ user_id: p.id, course_id: courseId });
    report(error && { message: error.code === '23505' ? 'Corso già assegnato a questo corsista.' : error.message }, 'Corso assegnato.');
  };

  const extend = async (e: Enrollment, days: number) => {
    const from = Math.max(Date.now(), new Date(e.expires_at).getTime());
    const { error } = await supabase.from('enrollments')
      .update({ expires_at: new Date(from + days * 86400000).toISOString() }).eq('id', e.id);
    report(error, `Scadenza prorogata di ${days} giorni.`);
  };

  const unassign = async (e: Enrollment) => {
    if (!confirm(`Togliere “${e.courses?.title}”? Si perdono ore e progressi registrati.`)) return;
    const { error } = await supabase.from('enrollments').delete().eq('id', e.id);
    report(error, 'Assegnazione eliminata.');
  };

  const move = async (p: Person, companyId: string) => {
    const { error } = await supabase.from('profiles').update({ company_id: companyId }).eq('id', p.id);
    report(error, 'Corsista spostato con le sue iscrizioni.');
  };

  const enterAs = async (id: string) => {
    try { await startImpersonation(id); navigate('/'); } catch (err) { report({ message: (err as Error).message }, ''); }
  };

  const needle = q.trim().toLowerCase();
  const shown = people.rows?.filter((p) =>
    !needle || `${p.first_name} ${p.last_name} ${p.email} ${p.codice_fiscale}`.toLowerCase().includes(needle));

  return (
    <>
      <PageTitle title="Corsisti" sub="Crea corsisti, assegna i corsi e segui ore, stato e scadenze." />
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {people.error && <Message kind="error">{people.error}</Message>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="Cerca per nome, email o codice fiscale" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca" />
        {isAdmin && (
          <select className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Azienda">
            <option value="">Tutte le aziende</option>
            {companies.rows?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <Panel>
        {shown?.length === 0 && <Empty>Nessun corsista.</Empty>}
        <ul className="divide-y divide-line">
          {shown?.map((p) => {
            const free = courses.rows?.filter((c) => !p.enrollments.some((e) => e.course_id === c.id)) ?? [];
            return (
              <li key={p.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{p.last_name} {p.first_name}</span>
                    {p.is_demo && <Badge tone="brand">Demo</Badge>}
                    {isAdmin && <span className="text-sm text-ink-muted">{p.companies?.name}</span>}
                    <span className="ml-auto flex flex-wrap gap-1">
                      {p.enrollments.map((e) => <EnrollmentBadge key={e.id} e={e} />)}
                      {p.enrollments.length === 0 && <Badge tone="muted">Nessun corso</Badge>}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-4">
                    <p className="text-sm text-ink-muted">
                      {p.email} · <span className="font-mono">{p.codice_fiscale}</span>
                    </p>
                    {p.enrollments.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line p-3">
                        <span className="min-w-40 flex-1 font-medium">{e.courses?.title}</span>
                        <EnrollmentBadge e={e} />
                        <Progress e={e} />
                        <span className="text-sm">Scadenza <strong>{fmtDate(e.expires_at)}</strong></span>
                        {isAdmin && e.status !== 'completato' && (
                          <span className="flex gap-2">
                            <button className={btn.ghost} onClick={() => extend(e, 30)}>Proroga 30 gg</button>
                            <button className={btn.ghost} onClick={() => unassign(e)}>Togli</button>
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap items-end gap-3">
                      {free.length > 0 && (
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium">Assegna corso</span>
                          <select className={inputCls} value="" onChange={(e) => e.target.value && assign(p, e.target.value)}>
                            <option value="">Scegli…</option>
                            {free.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                        </label>
                      )}
                      {isAdmin && (
                        <>
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium">Sposta in azienda</span>
                            <select className={inputCls} value={p.company_id} onChange={(e) => move(p, e.target.value)}>
                              {companies.rows?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </label>
                          <button className={btn.ghost} onClick={() => enterAs(p.id)}>Entra come</button>
                        </>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Nuovo corsista">
        <form onSubmit={addPerson} className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Nome" name="first_name" required />
          <Field label="Cognome" name="last_name" required />
          <Field label="Codice fiscale" name="codice_fiscale" required pattern="[A-Za-z0-9]{16}" title="16 caratteri" className={`${inputCls} font-mono uppercase`} />
          <Field label="Email" name="email" type="email" required />
          {isAdmin && (
            <>
              <Select label="Azienda" name="company_id" required>
                {companies.rows?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <label className="mb-4 flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_demo" /> Account demo
              </label>
            </>
          )}
          <div className="sm:col-span-2">
            <p className="mb-3 text-sm text-ink-muted">L’account viene creato con la password standard; il corsista potrà cambiarla dal profilo.</p>
            <button className={btn.primary}>Crea corsista</button>
          </div>
        </form>
      </Panel>
    </>
  );
}
