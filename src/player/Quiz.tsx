import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Badge, btn, Message, PageTitle, Panel } from '../ui';

type Question = { id: string; text: string; options: { id: string; text: string }[] };
type Attempt = { attempt_id: string; deadline_at: string; questions: Question[] };
type Result = {
  score: number; passed: boolean; correct: number; total: number; threshold: number;
  attempts_used: number; max_attempts: number; course_reset: boolean;
  results: { question_id: string; correct: boolean }[];
};
export type QuizStatus = {
  can_start: boolean; reason: string | null; lessons_missing: number; questions: number | null;
  minutes_per_question: number | null; max_attempts: number | null; threshold: number;
  attempts_used: number; open_attempt: string | null;
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Le risposte scelte restano nel browser (sessionStorage) finché non si consegna:
// ricaricando la pagina si riprende lo stesso tentativo con le stesse risposte.
const saved = (id: string) => { try { return JSON.parse(sessionStorage.getItem(`quiz:${id}`) ?? '{}'); } catch { return {}; } };

export default function Quiz() {
  const { id = '' } = useParams();
  const [status, setStatus] = useState<QuizStatus | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);

  const loadStatus = () => supabase.rpc('quiz_status', { p_enrollment: id })
    .then(({ data, error }) => error ? setError(error.message) : setStatus(data));
  useEffect(() => { loadStatus(); }, [id]);

  const start = async () => {
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('start_quiz', { p_enrollment: id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    submitted.current = false;
    setAttempt(data);
    setAnswers(saved(data.attempt_id));
    setResult(null);
  };

  const submit = async () => {
    if (!attempt || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    const { data, error } = await supabase.rpc('submit_quiz', { p_attempt: attempt.attempt_id, p_answers: answers });
    setBusy(false);
    if (error) { setError(error.message); submitted.current = false; return; }
    sessionStorage.removeItem(`quiz:${attempt.attempt_id}`);
    setResult(data);
    setAttempt(null);
    loadStatus();
  };

  // Countdown; allo scadere consegna da solo.
  const left = attempt ? new Date(attempt.deadline_at).getTime() - now : 0;
  useEffect(() => {
    if (!attempt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [attempt]);
  useEffect(() => { if (attempt && left <= 0) submit(); }, [attempt, left <= 0]);

  const choose = (q: string, o: string) => {
    const next = { ...answers, [q]: o };
    setAnswers(next);
    try { sessionStorage.setItem(`quiz:${attempt!.attempt_id}`, JSON.stringify(next)); } catch { /* solo comodità */ }
  };

  const back = <Link to={`/corso/${id}`} className="text-sm font-medium text-brand-strong">← Torna al corso</Link>;

  if (attempt) {
    const done = Object.keys(answers).length;
    return (
      <div className="mx-auto max-w-3xl">
        <div className="sticky top-0 z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <span className="font-semibold">Test finale · {done} di {attempt.questions.length} risposte</span>
          <span className={`font-mono text-lg tabular-nums ${left < 120_000 ? 'text-danger' : ''}`} role="timer" aria-label="Tempo rimasto">{mmss(left)}</span>
        </div>
        {error && <Message kind="error">{error}</Message>}
        <ol className="space-y-4">
          {attempt.questions.map((q, i) => (
            <li key={q.id}>
              <Panel>
                <fieldset>
                  <legend className="mb-3 font-semibold"><span className="text-brand-strong">{i + 1}.</span> {q.text}</legend>
                  <div className="space-y-2">
                    {q.options.map((o) => (
                      <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${answers[q.id] === o.id ? 'border-brand-strong bg-brand-soft' : 'border-line hover:border-ink'}`}>
                        <input type="radio" name={q.id} className="mt-1" checked={answers[q.id] === o.id} onChange={() => choose(q.id, o.id)} />
                        <span>{o.text}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </Panel>
            </li>
          ))}
        </ol>
        <div className="mb-10 flex flex-wrap items-center gap-3">
          <button className={btn.primary} disabled={busy}
                  onClick={() => (done === attempt.questions.length || confirm(`Hai risposto a ${done} domande su ${attempt.questions.length}. Consegnare comunque?`)) && submit()}>
            Consegna il test
          </button>
          <span className="text-sm text-ink-muted">Allo scadere del tempo il test viene consegnato automaticamente.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <PageTitle title="Test finale" />
      {error && <Message kind="error">{error}</Message>}
      {result && (
        <Panel>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-3xl font-bold tabular-nums">{result.score.toLocaleString('it-IT')}%</span>
            {result.passed ? <Badge tone="ok">Superato</Badge> : <Badge tone="bad">Non superato</Badge>}
          </div>
          <p className="text-ink-muted">{result.correct} risposte corrette su {result.total} · soglia {result.threshold}%</p>
          {result.passed && <p className="mt-3">Complimenti! L’attestato sarà disponibile nella pagina dei tuoi corsi.</p>}
          {!result.passed && !result.course_reset && <p className="mt-3">Tentativo {result.attempts_used} di {result.max_attempts}: puoi ripetere il test con nuove domande.</p>}
          {result.course_reset && <p className="mt-3 font-medium text-danger">Hai esaurito i {result.max_attempts} tentativi: per legge il corso va ripetuto. Ore e lezioni ripartono da zero.</p>}
          <ol className="mt-4 flex flex-wrap gap-1.5" aria-label="Esito per domanda">
            {result.results.map((r, i) => (
              <li key={r.question_id} className={`grid h-8 w-8 place-items-center rounded-lg text-sm font-semibold ${r.correct ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
                  title={r.correct ? 'Corretta' : 'Errata'}>{i + 1}</li>
            ))}
          </ol>
        </Panel>
      )}
      {status && !result?.passed && (
        <Panel>
          {status.can_start ? (
            <>
              <ul className="mb-4 list-disc space-y-1 pl-5">
                <li>{status.questions} domande a risposta multipla, estratte a caso</li>
                <li>{status.minutes_per_question} minuti per domanda: {(status.questions ?? 0) * (status.minutes_per_question ?? 0)} minuti in tutto</li>
                <li>Si supera con almeno il {status.threshold}% di risposte corrette</li>
                <li>Tentativi usati: {status.attempts_used} di {status.max_attempts}. Esauriti i tentativi, il corso va ripetuto.</li>
              </ul>
              <button className={btn.primary} disabled={busy} onClick={start}>{status.open_attempt ? 'Riprendi il test' : 'Inizia il test'}</button>
            </>
          ) : (
            <p>{{
              superato: 'Hai già superato il test.',
              scaduto: 'Il corso è scaduto: contatta l’amministratore.',
              non_configurato: 'Il test di questo corso non è ancora configurato.',
              lezioni: `Completa prima tutte le lezioni (ne mancano ${status.lessons_missing}).`,
              ore: 'Non hai ancora raggiunto le ore di studio richieste dal corso.',
              banco: 'Il banco domande non è ancora pronto.',
            }[status.reason ?? ''] ?? 'Test non disponibile.'}</p>
          )}
        </Panel>
      )}
    </div>
  );
}
