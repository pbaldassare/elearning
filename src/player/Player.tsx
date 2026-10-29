import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { Badge, btn, fmtDate, fmtHours, Message, type Enrollment } from '../ui';
import { handleQuizClick, slideHTML, type Slide } from './slides';
import Media from './Media';
import './slides.css';

type Outline = { id: string; title: string; topic: string | null; min_seconds: number; module: string; mpos: number; pos: number };
type Lesson = Outline & {
  slides: Slide[]; narration: string | null; sources: { title: string; url: string }[];
  audio_path: string | null; video_path: string | null; captions_path: string | null;
};
type LessonProgress = { lesson_id: string; active_seconds: number; completed_at: string | null };
type Course = Enrollment & { courses: { title: string; required_hours: number; is_demo: boolean } };

const HEARTBEAT_MS = 30_000;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// Ore attive: heartbeat ogni 30 s solo con scheda in primo piano e interazione recente.
// Il conteggio vero lo fa il server (public.heartbeat); qui si decide solo se mandarlo.
function useHeartbeat(enrollmentId: string, lessonId: string | null, enabled: boolean,
                      onData: (d: { lesson_seconds: number; total_seconds: number }) => void,
                      onError: (m: string) => void) {
  const lastActivity = useRef(Date.now());
  const cb = useRef({ onData, onError });
  cb.current = { onData, onError };
  const [idleMs, setIdleMs] = useState(5 * 60_000);
  const [active, setActive] = useState(true);

  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'idle_minutes').maybeSingle()
      .then(({ data }) => data && setIdleMs(Number(data.value) * 60_000));
    const touch = () => { lastActivity.current = Date.now(); };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    evs.forEach((e) => addEventListener(e, touch, { passive: true }));
    return () => evs.forEach((e) => removeEventListener(e, touch));
  }, []);

  useEffect(() => {
    if (!enabled || !lessonId) return;
    const beat = async () => {
      const ok = document.visibilityState === 'visible' && Date.now() - lastActivity.current < idleMs;
      setActive(ok);
      if (!ok) return;
      const { data, error } = await supabase.rpc('heartbeat', { p_enrollment: enrollmentId, p_lesson: lessonId });
      if (error) cb.current.onError(error.message); else cb.current.onData(data);
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const vis = () => document.visibilityState === 'visible' && beat();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, enrollmentId, lessonId, idleMs]);

  return active;
}

export default function Player() {
  const { id = '' } = useParams();
  const { who } = useAuth();
  const wide = useWide();
  const [course, setCourse] = useState<Course | null>(null);
  const [outline, setOutline] = useState<Outline[]>([]);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [current, setCurrent] = useState<Lesson | null>(null);
  const [slide, setSlide] = useState(0);
  const [index, setIndex] = useState(false);
  const [error, setError] = useState('');

  const demo = !!course?.courses.is_demo;
  const viewOnly = !!who?.impersonating && !demo; // "Entra come" su corso vero: si guarda soltanto
  const expired = !!course && course.status !== 'completato' && new Date(course.expires_at) < new Date();

  useEffect(() => {
    (async () => {
      const { data: e, error } = await supabase.from('enrollments')
        .select('*, courses(title, required_hours, is_demo)').eq('id', id).single();
      if (error) { setError('Corso non trovato.'); return; }
      setCourse(e as Course);
      const [{ data: cl }, { data: pr }] = await Promise.all([
        supabase.from('course_lessons')
          .select('lessons(id, title, topic, position, min_seconds, modules(title, position))').eq('course_id', e.course_id),
        supabase.from('lesson_progress').select('lesson_id, active_seconds, completed_at').eq('enrollment_id', id),
      ]);
      type Row = { lessons: { id: string; title: string; topic: string | null; position: number; min_seconds: number; modules: { title: string; position: number } } | null };
      const list = ((cl ?? []) as unknown as Row[]).flatMap(({ lessons: l }) => l ? [{
        id: l.id, title: l.title, topic: l.topic, min_seconds: l.min_seconds, module: l.modules.title, mpos: l.modules.position, pos: l.position,
      }] : []).sort((a, b) => a.mpos - b.mpos || a.pos - b.pos);
      setOutline(list);
      setProgress(Object.fromEntries(((pr ?? []) as LessonProgress[]).map((p) => [p.lesson_id, p])));
    })();
  }, [id]);

  // Sbloccate: tutte fino alla prima non completata (la stessa regola la applica il server).
  const firstOpen = outline.findIndex((l) => !progress[l.id]?.completed_at);
  const unlockedUpTo = firstOpen === -1 ? outline.length - 1 : firstOpen;
  const allDone = outline.length > 0 && firstOpen === -1;

  const open = async (l: Outline) => {
    setError('');
    const { data, error } = await supabase.from('lessons')
      .select('slides, narration, sources, audio_path, video_path, captions_path').eq('id', l.id).single();
    if (error) { setError(error.message); return; }
    setCurrent({ ...l, ...(data as Omit<Lesson, keyof Outline>) });
    setSlide(0);
    scrollTo({ top: 0 });
  };

  // All'apertura riprende dalla prima lezione non completata.
  useEffect(() => {
    if (!current && outline.length) open(outline[unlockedUpTo]);
  }, [outline.length]);

  const active = useHeartbeat(id, current?.id ?? null, !!current && !viewOnly && !demo && !expired,
    (d) => {
      setProgress((p) => ({ ...p, [current!.id]: { ...(p[current!.id] ?? { lesson_id: current!.id, completed_at: null }), active_seconds: d.lesson_seconds } }));
      setCourse((c) => c && { ...c, active_seconds: d.total_seconds, status: c.status === 'assegnato' ? 'in_corso' : c.status });
    },
    setError);

  const complete = async () => {
    if (!current) return;
    const { error } = await supabase.rpc('complete_lesson', { p_enrollment: id, p_lesson: current.id });
    if (error) { setError(error.message); return; }
    const next = { ...progress, [current.id]: { lesson_id: current.id, active_seconds: progress[current.id]?.active_seconds ?? 0, completed_at: new Date().toISOString() } };
    setProgress(next);
    const i = outline.findIndex((l) => l.id === current.id);
    if (outline[i + 1]) open(outline[i + 1]);
  };

  const html = useMemo(() => current && current.slides[slide] && slideHTML(current.slides[slide], slide + 1, {
    topic: current.topic ?? current.module, total: current.slides.length,
    minutes: Math.round(current.min_seconds / 60), course: course?.courses.title ?? '',
  }), [current, slide, course?.courses.title]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!current || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') setSlide((s) => Math.min(s + 1, current.slides.length - 1));
      if (e.key === 'ArrowLeft') setSlide((s) => Math.max(s - 1, 0));
      if (e.key === 'Escape') setIndex(false);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [current]);

  if (!course) return error ? <Message kind="error">{error}</Message> : null;

  const p = current ? progress[current.id] : undefined;
  const seconds = p?.active_seconds ?? 0;
  const timeOk = demo || seconds >= (current?.min_seconds ?? 0);
  const lastSlide = !!current && slide === current.slides.length - 1;
  const hoursOk = course.active_seconds >= course.courses.required_hours * 3600;
  const modules = [...new Set(outline.map((l) => l.module))];

  const done = outline.filter((l) => progress[l.id]?.completed_at).length;
  const pct = Math.min(100, (course.active_seconds / (course.courses.required_hours * 3600)) * 100);

  return (
    <div>
      {/* Intestazione sottile: corso, avanzamento, indice e test. Il resto dello schermo è della lezione. */}
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-white/95 px-4 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link to="/" className="mr-auto text-sm font-medium text-ink-muted hover:text-ink sm:mr-0">← I miei corsi</Link>
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            <p className="truncate font-semibold">{course.courses.title}{demo && <span className="ml-2 align-middle"><Badge tone="brand">Dimostrativo</Badge></span>}</p>
            <p className="text-xs text-ink-muted tabular-nums">
              {done} di {outline.length} lezioni · {fmtHours(course.active_seconds)} di {course.courses.required_hours} h · scadenza {fmtDate(course.expires_at)}
            </p>
          </div>
          {allDone && (course.status === 'completato'
            ? <Badge tone="ok">Test superato</Badge>
            : (hoursOk || demo) && <Link to={`/corso/${id}/test`} className={btn.primary}>Vai al test</Link>)}
          <button className={btn.ghost} aria-expanded={index} aria-controls="indice" onClick={() => setIndex(true)}>Indice<span className="hidden sm:inline"> lezioni</span></button>
        </div>
        <div className="h-1 bg-surface" aria-hidden="true"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
      </header>

      {index && <div className="fixed inset-0 z-30 bg-ink/40" onClick={() => setIndex(false)} aria-hidden="true" />}
      <aside id="indice" aria-label="Indice delle lezioni"
             className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col bg-white shadow-xl transition-transform ${index ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="font-semibold">Indice delle lezioni</h2>
          <button className={btn.ghost} onClick={() => setIndex(false)}>Chiudi</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {modules.map((m) => (
            <div key={m} className="mb-4">
              <h3 className="mb-1 px-2 text-xs font-bold uppercase tracking-wider text-ink-muted">{m}</h3>
              <ol className="space-y-0.5">
                {outline.map((l, i) => l.module !== m ? null : (
                  <li key={l.id}>
                    <button
                      disabled={i > unlockedUpTo}
                      onClick={() => { open(l); setIndex(false); }}
                      aria-current={current?.id === l.id}
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${current?.id === l.id ? 'bg-brand-soft font-semibold text-brand-strong' : 'hover:bg-surface'}`}
                    >
                      <span aria-hidden="true" className="w-4 flex-none">{progress[l.id]?.completed_at ? '✓' : i > unlockedUpTo ? '🔒' : '•'}</span>
                      <span>{l.title}<span className="sr-only">{progress[l.id]?.completed_at ? ' (completata)' : i > unlockedUpTo ? ' (bloccata)' : ''}</span></span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </aside>

      <section className="mx-auto max-w-5xl">
        {error && <Message kind="error">{error}</Message>}
        {expired && <Message kind="error">Il corso è scaduto il {fmtDate(course.expires_at)}: contatta l’amministratore per una proroga.</Message>}
        {viewOnly && (
          <p className="mb-4 rounded-xl bg-surface p-3 text-sm text-ink-muted">
            Stai guardando il corso di un altro utente: ore e completamenti non vengono registrati.
          </p>
        )}
        {allDone && course.status !== 'completato' && !hoursOk && !demo && (
          <p className="mb-4 rounded-xl bg-surface p-3 text-sm text-ink-muted">
            Lezioni completate. Il test si sblocca a {course.courses.required_hours} ore di studio (ora {fmtHours(course.active_seconds)} h): puoi rivedere le lezioni.
          </p>
        )}

        {current && html && (
          <>
            <div className="mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-strong">{current.module}</p>
              <h1 className="mt-0.5 truncate text-xl font-bold tracking-tight">{current.title}</h1>
            </div>
            {(current.video_path || current.audio_path) && <Media lesson={current} />}
            <div
              // Da desktop la slide occupa lo spazio dello schermo (scorre dentro se è lunga): comandi sempre visibili.
              className={`slides overflow-y-auto rounded-2xl border border-line bg-white shadow-sm lg:h-[calc(100dvh-250px)] lg:min-h-[360px] ${wide ? 'wide' : ''}`}
              onClick={(e) => handleQuizClick(e.target)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
              <button className={btn.ghost} disabled={slide === 0} onClick={() => setSlide(slide - 1)}>← Indietro</button>
              <span className="text-sm tabular-nums text-ink-muted">{slide + 1} / {current.slides.length}</span>
              <button className={btn.ghost} disabled={lastSlide} onClick={() => setSlide(slide + 1)}>Avanti →</button>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                {!demo && !p?.completed_at && (
                  <span className="text-sm tabular-nums text-ink-muted" aria-live="polite">
                    {timeOk ? 'Tempo minimo raggiunto' : `Tempo di studio ${mmss(seconds)} di ${mmss(current.min_seconds)}`}
                    {!active && !viewOnly && ' · in pausa'}
                  </span>
                )}
                {p?.completed_at ? <Badge tone="ok">Lezione completata</Badge> : (
                  <button className={btn.primary} disabled={viewOnly || expired || !timeOk || !lastSlide} onClick={complete}
                          title={!lastSlide ? 'Arriva all’ultima slide' : !timeOk ? 'Tempo minimo non ancora raggiunto' : undefined}>
                    Completa e prosegui
                  </button>
                )}
              </div>
            </div>
            {!demo && !p?.completed_at && !lastSlide && <p className="mt-2 text-xs text-ink-muted">Per completare la lezione arriva all’ultima slide e raggiungi il tempo minimo di studio.</p>}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              {current.narration && (
                <details className="rounded-2xl border border-line bg-white p-4">
                  <summary className="cursor-pointer font-semibold">Leggi il testo della lezione</summary>
                  <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2">
                    {current.narration.split(/\n\s*\n/).map((t, i) => <p key={i}>{t}</p>)}
                  </div>
                </details>
              )}
              {current.sources.length > 0 && (
                <div className="rounded-2xl border border-line bg-white p-4">
                  <h3 className="font-semibold">Fonti</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
                    {current.sources.map((s) => <li key={s.url}><a className="text-brand-strong underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
