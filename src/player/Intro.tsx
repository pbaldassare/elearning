import { btn, fmtDate, fmtHours } from '../ui';

export type IntroCourse = {
  title: string; description: string | null; required_hours: number; is_demo: boolean; pass_threshold: number;
  quiz_questions_drawn: number | null; quiz_max_attempts: number | null; quiz_minutes_per_question: number | null;
};
type Lesson = { id: string; title: string; module: string; mpos: number; min_seconds: number };

// Introduzione del corso: descrizione dall'Admin, regole e argomenti letti dai dati del corso.
export default function Intro({ course, expires, lessons, started, onStart }: {
  course: IntroCourse; expires: string; lessons: Lesson[]; started: boolean; onStart: () => void;
}) {
  const modules = [...new Map(lessons.map((l) => [l.mpos, l.module])).entries()].sort((a, b) => a[0] - b[0]);
  const q = course.quiz_questions_drawn;
  const numbers: [string, string][] = [
    [`${course.required_hours}`, 'ore di studio'],
    [`${lessons.length}`, 'lezioni'],
    [`${modules.length}`, modules.length === 1 ? 'area' : 'aree'],
    [fmtDate(expires), 'da completare entro'],
  ];
  const steps: [string, string][] = course.is_demo ? [
    ['Corso dimostrativo', 'Stesse lezioni del corso vero, ma senza tempi di attesa: puoi scorrerle liberamente per vedere come funziona.'],
    ['Test finale', q ? `${q} domande a risposta multipla, ${course.quiz_minutes_per_question} minuti per domanda, si supera con il ${course.pass_threshold}%.` : 'Il test di questo corso non è ancora configurato.'],
    ['Attestato di prova', 'Superato il test scarichi un attestato con la dicitura "di prova": non ha valore ufficiale.'],
  ] : [
    ['Lezioni in ordine', 'Si sblocca una lezione alla volta: per passare alla successiva arrivi all’ultima slide e resti almeno il tempo minimo indicato. Le lezioni completate puoi rivederle quando vuoi.'],
    ['Conta il tempo attivo', `Le ${course.required_hours} ore sono tempo di studio vero: il conteggio si ferma se cambi scheda o se non interagisci con la pagina per alcuni minuti. Puoi interrompere e riprendere quando vuoi.`],
    ['Test finale', q
      ? `Si sblocca quando hai completato tutte le lezioni e raggiunto le ${course.required_hours} ore. ${q} domande estratte a caso, ${course.quiz_minutes_per_question} minuti per domanda, si supera con il ${course.pass_threshold}%. Hai ${course.quiz_max_attempts} tentativi: se non lo superi, il corso va ripetuto.`
      : 'Si sblocca quando hai completato tutte le lezioni e raggiunto le ore richieste.'],
    ['Attestato', 'Superato il test, l’attestato è subito disponibile da scaricare in PDF nella pagina dei tuoi corsi.'],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-card p-6 shadow-lift sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-strong">Introduzione al corso</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{course.title}</h1>
        {course.description?.split(/\n\s*\n/).map((p, i) => <p key={i} className="mt-3 max-w-3xl text-ink-muted">{p}</p>)}
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numbers.map(([v, l]) => (
            <div key={l} className="rounded-xl bg-surface-2 p-4">
              <dd className="text-xl font-extrabold tabular-nums sm:text-2xl">{v}</dd>
              <dt className="text-xs text-ink-muted">{l}</dt>
            </div>
          ))}
        </dl>
        <button className={`${btn.primary} mt-6 px-5 py-2.5 text-base`} onClick={onStart}>{started ? 'Torna alle lezioni' : 'Inizia il corso'}</button>
      </section>

      <section className="rounded-2xl border border-line bg-card p-6 shadow-lift sm:p-8">
        <h2 className="text-lg font-bold">Come funziona</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-2">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-xl border border-line p-4">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-brand-soft font-extrabold text-brand-strong">{i + 1}</span>
              <div><b>{t}</b><p className="mt-1 text-sm text-ink-muted">{d}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-line bg-card p-6 shadow-lift sm:p-8">
        <h2 className="text-lg font-bold">Di cosa parla</h2>
        <div className="mt-4 grid gap-3">
          {modules.map(([pos, name]) => {
            const ls = lessons.filter((l) => l.mpos === pos);
            return (
              <details key={pos} className={`area-${pos} rounded-xl border border-line p-4`}>
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className="area-block grid h-10 w-10 flex-none place-items-center rounded-xl text-lg font-extrabold" aria-hidden="true">{pos}</span>
                  <span className="min-w-0 flex-1"><b className="text-area">{name}</b>
                    <span className="block text-xs text-ink-muted">{ls.length} lezioni · circa {fmtHours(ls.reduce((s, l) => s + l.min_seconds, 0))} ore · tocca per vedere i titoli</span>
                  </span>
                </summary>
                <ol className="mt-3 list-decimal space-y-1 pl-14 text-sm text-ink-muted">{ls.map((l) => <li key={l.id}>{l.title}</li>)}</ol>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
