import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useRows } from '../../lib/useRows';
import { Badge, btn, Field, inputCls, Message, PageTitle, Panel, Select } from '../../ui';

type Course = {
  id: string; title: string; required_hours: number; status: 'attivo' | 'non_attivo' | 'archiviato';
  certificate_type: 'modello_ivass' | 'generato_sistema'; pass_threshold: number; expiry_days: number;
  quiz_questions_drawn: number | null; quiz_max_attempts: number | null; quiz_minutes_per_question: number | null; is_demo: boolean;
  description: string | null;
  course_lessons: { count: number }[];
};
type Category = { id: string; name: string; slug: string; archived_at: string | null; courses: Course[] };

const statusLabel = { attivo: 'Attivo', non_attivo: 'Non attivo', archiviato: 'Archiviato' };
const statusTone = { attivo: 'ok', non_attivo: 'muted', archiviato: 'warn' } as const;
const certLabel = { modello_ivass: 'Modello IVASS', generato_sistema: 'Generato dal sistema' };

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const numOrNull = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));

export default function Courses() {
  const cats = useRows<Category>(() =>
    supabase.from('categories').select('*, courses(*, course_lessons(count))').order('created_at').order('title', { referencedTable: 'courses' }));
  const libs = useRows<{ id: string; name: string }>(() => supabase.from('lesson_libraries').select('id, name').order('name'));
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const done = async (error: { message: string } | null, ok: string) => {
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: ok });
    if (!error) await Promise.all([cats.reload(), libs.reload()]);
    return !error;
  };

  const addCategory = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name')).trim();
    const { error } = await supabase.from('categories').insert({ name, slug: slugify(name) });
    if (await done(error, 'Categoria creata.')) form.reset();
  };

  const addCourse = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const title = String(f.get('title')).trim();
    let library_id = String(f.get('library_id'));
    if (library_id === 'nuova') {
      const { data, error } = await supabase.from('lesson_libraries').insert({ name: title }).select('id').single();
      if (!(await done(error, ''))) return;
      library_id = data!.id;
    }
    const { error } = await supabase.from('courses').insert({
      title, library_id, category_id: f.get('category_id'), required_hours: Number(f.get('required_hours')),
      certificate_type: f.get('certificate_type'),
    });
    if (await done(error, 'Corso creato (non attivo).')) form.reset();
  };

  const saveCourse = async (id: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('courses').update({
      title: f.get('title'), status: f.get('status'), certificate_type: f.get('certificate_type'),
      description: String(f.get('description') ?? '').trim() || null,
      required_hours: Number(f.get('required_hours')), pass_threshold: Number(f.get('pass_threshold')),
      expiry_days: Number(f.get('expiry_days')),
      quiz_questions_drawn: numOrNull(f.get('quiz_questions_drawn')),
      quiz_max_attempts: numOrNull(f.get('quiz_max_attempts')),
      quiz_minutes_per_question: numOrNull(f.get('quiz_minutes_per_question')),
    }).eq('id', id);
    await done(error, 'Corso salvato.');
  };

  const toggleCategory = async (c: Category) => {
    const { error } = await supabase.from('categories')
      .update({ archived_at: c.archived_at ? null : new Date().toISOString() }).eq('id', c.id);
    await done(error, c.archived_at ? 'Categoria ripristinata.' : 'Categoria archiviata.');
  };

  return (
    <>
      <PageTitle title="Categorie e corsi" sub="Crea, modifica e archivia corsi. I parametri del test vuoti significano “non ancora configurato”: il test non parte." />
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {cats.error && <Message kind="error">{cats.error}</Message>}

      {cats.rows?.map((cat) => (
        <Panel key={cat.id} title={cat.name} actions={
          <button className={btn.ghost} onClick={() => toggleCategory(cat)}>{cat.archived_at ? 'Ripristina' : 'Archivia categoria'}</button>
        }>
          {cat.archived_at && <p className="mb-3"><Badge tone="warn">Archiviata</Badge></p>}
          {cat.courses.length === 0 && <p className="text-ink-muted">Nessun corso.</p>}
          <div className="space-y-3">
            {cat.courses.map((c) => (
              <details key={c.id} className="rounded-xl border border-line p-4">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.title}</span>
                  <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
                  {c.is_demo && <Badge tone="brand">Dimostrativo · senza attesa</Badge>}
                  <span className="text-sm text-ink-muted">
                    {c.required_hours} h · {c.course_lessons[0]?.count ?? 0} lezioni · {certLabel[c.certificate_type]}
                  </span>
                </summary>
                <form onSubmit={(e) => saveCourse(c.id, e)} className="mt-4 grid gap-x-4 sm:grid-cols-3">
                  <div className="sm:col-span-3"><Field label="Titolo" name="title" defaultValue={c.title} required /></div>
                  <label className="mb-4 block sm:col-span-3">
                    <span className="mb-1 block text-sm font-medium">Introduzione (la vede il corsista prima di iniziare; riga vuota = nuovo paragrafo)</span>
                    <textarea name="description" rows={5} className={inputCls} defaultValue={c.description ?? ''} />
                  </label>
                  <Select label="Stato" name="status" defaultValue={c.status}>
                    {Object.entries(statusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  <Select label="Certificato" name="certificate_type" defaultValue={c.certificate_type}>
                    {Object.entries(certLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  <Field label="Durata obbligatoria (ore)" name="required_hours" type="number" min="0.5" step="0.5" defaultValue={c.required_hours} required />
                  <Field label="Soglia superamento (%)" name="pass_threshold" type="number" min="0" max="100" defaultValue={c.pass_threshold} required />
                  <Field label="Giorni per completare" name="expiry_days" type="number" min="1" defaultValue={c.expiry_days} required />
                  <span className="hidden sm:block" />
                  <Field label="Domande estratte" name="quiz_questions_drawn" type="number" min="1" defaultValue={c.quiz_questions_drawn ?? ''} placeholder="da fornire" />
                  <Field label="Tentativi (poi si rifà il corso)" name="quiz_max_attempts" type="number" min="1" defaultValue={c.quiz_max_attempts ?? ''} placeholder="da fornire" />
                  <Field label="Minuti per domanda" name="quiz_minutes_per_question" type="number" min="1" defaultValue={c.quiz_minutes_per_question ?? ''} placeholder="da fornire" />
                  <div><button className={btn.primary}>Salva corso</button></div>
                </form>
              </details>
            ))}
          </div>
        </Panel>
      ))}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Nuovo corso">
          <form onSubmit={addCourse}>
            <Field label="Titolo" name="title" required />
            <Select label="Categoria" name="category_id" required>
              {cats.rows?.filter((c) => !c.archived_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select key={libs.rows?.length} label="Libreria di lezioni" name="library_id">
              {libs.rows?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="nuova">Nuova libreria (stesso nome del corso)</option>
            </Select>
            <Field label="Durata obbligatoria (ore)" name="required_hours" type="number" min="0.5" step="0.5" required />
            <Select label="Certificato" name="certificate_type">
              {Object.entries(certLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <button className={btn.primary}>Crea corso</button>
          </form>
        </Panel>
        <Panel title="Nuova categoria">
          <form onSubmit={addCategory}>
            <Field label="Nome" name="name" required />
            <button className={btn.primary}>Crea categoria</button>
          </form>
        </Panel>
      </div>
    </>
  );
}
