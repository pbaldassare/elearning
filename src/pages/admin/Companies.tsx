import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { callFn, supabase } from '../../lib/supabase';
import { useRows } from '../../lib/useRows';
import { Badge, btn, Empty, Field, Message, PageTitle, Panel } from '../../ui';

type Company = {
  id: string; name: string; vat_number: string | null; email: string | null; is_demo: boolean; archived_at: string | null;
  company_courses: { course_id: string }[];
  profiles: { id: string; role: string; first_name: string; last_name: string; email: string }[];
};

export default function Companies() {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const companies = useRows<Company>(() =>
    supabase.from('companies').select('*, company_courses(course_id), profiles(id, role, first_name, last_name, email)').order('name'));
  const courses = useRows<{ id: string; title: string; status: string }>(() =>
    supabase.from('courses').select('id, title, status').neq('status', 'archiviato').order('title'));
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const report = (error: { message: string } | null, ok: string) => {
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: ok });
    if (!error) companies.reload();
    return !error;
  };

  const addCompany = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const { error } = await supabase.from('companies').insert({
      name: String(f.get('name')).trim(), vat_number: String(f.get('vat_number')).trim() || null,
      email: String(f.get('email')).trim() || null, is_demo: f.get('is_demo') === 'on',
    });
    if (report(error, 'Azienda creata.')) form.reset();
  };

  const toggleCourse = async (c: Company, courseId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from('company_courses').insert({ company_id: c.id, course_id: courseId })
      : await supabase.from('company_courses').delete().eq('company_id', c.id).eq('course_id', courseId);
    report(error, on ? 'Corso assegnato all’azienda.' : 'Corso tolto all’azienda.');
  };

  const addReferente = async (c: Company, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await callFn('create-user', {
        role: 'azienda', company_id: c.id,
        first_name: f.get('first_name'), last_name: f.get('last_name'), email: f.get('email'),
      });
      form.reset();
      report(null, 'Accesso azienda creato con la password standard.');
    } catch (err) {
      report({ message: (err as Error).message }, '');
    }
  };

  const archive = async (c: Company) => {
    const { error } = await supabase.from('companies')
      .update({ archived_at: c.archived_at ? null : new Date().toISOString() }).eq('id', c.id);
    report(error, c.archived_at ? 'Azienda ripristinata.' : 'Azienda archiviata.');
  };

  const enterAs = async (id: string) => {
    try { await startImpersonation(id); navigate('/'); } catch (err) { report({ message: (err as Error).message }, ''); }
  };

  return (
    <>
      <PageTitle title="Aziende" sub="Crea le aziende, assegna loro i corsi e crea gli accessi dei referenti." />
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {companies.error && <Message kind="error">{companies.error}</Message>}
      {companies.rows?.length === 0 && <Empty>Nessuna azienda.</Empty>}

      {companies.rows?.map((c) => {
        const refs = c.profiles.filter((p) => p.role === 'azienda');
        const assigned = new Set(c.company_courses.map((x) => x.course_id));
        return (
          <Panel key={c.id} title={c.name} actions={
            <div className="flex flex-wrap items-center gap-2">
              {c.is_demo && <Badge tone="brand">Demo</Badge>}
              {c.archived_at && <Badge tone="warn">Archiviata</Badge>}
              <span className="text-sm text-ink-muted">{c.profiles.filter((p) => p.role === 'corsista').length} corsisti</span>
              <button className={btn.ghost} onClick={() => archive(c)}>{c.archived_at ? 'Ripristina' : 'Archivia'}</button>
            </div>
          }>
            <p className="mb-4 text-sm text-ink-muted">{[c.vat_number && `P. IVA ${c.vat_number}`, c.email].filter(Boolean).join(' · ') || 'Nessun dato fiscale'}</p>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold">Corsi assegnati</h3>
                {courses.rows?.map((co) => (
                  <label key={co.id} className="flex items-center gap-2 py-1">
                    <input type="checkbox" checked={assigned.has(co.id)} onChange={(e) => toggleCourse(c, co.id, e.target.checked)} />
                    {co.title} {co.status !== 'attivo' && <Badge tone="muted">Non attivo</Badge>}
                  </label>
                ))}
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Referenti con accesso</h3>
                <ul className="mb-3">
                  {refs.length === 0 && <li className="text-ink-muted">Nessuno.</li>}
                  {refs.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                      <span>{p.first_name} {p.last_name} <span className="text-sm text-ink-muted">{p.email}</span></span>
                      <button className={btn.ghost} onClick={() => enterAs(p.id)}>Entra come</button>
                    </li>
                  ))}
                </ul>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-strong">Aggiungi referente</summary>
                  <form onSubmit={(e) => addReferente(c, e)} className="mt-3">
                    <div className="grid gap-x-3 sm:grid-cols-2">
                      <Field label="Nome" name="first_name" required />
                      <Field label="Cognome" name="last_name" required />
                    </div>
                    <Field label="Email" name="email" type="email" required />
                    <button className={btn.primary}>Crea accesso</button>
                  </form>
                </details>
              </div>
            </div>
          </Panel>
        );
      })}

      <Panel title="Nuova azienda">
        <form onSubmit={addCompany} className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Ragione sociale" name="name" required />
          <Field label="Partita IVA" name="vat_number" />
          <Field label="Email" name="email" type="email" />
          <label className="mb-4 flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="is_demo" /> Azienda demo (certificati di prova, esclusa da report e conteggi)
          </label>
          <div><button className={btn.primary}>Crea azienda</button></div>
        </form>
      </Panel>
    </>
  );
}
