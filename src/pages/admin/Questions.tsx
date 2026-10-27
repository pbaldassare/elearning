import { useMemo, useState, type ChangeEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useRows } from '../../lib/useRows';
import { Badge, btn, Empty, inputCls, Message, PageTitle, Panel } from '../../ui';

type Option = { id?: string; position: number; text: string; is_correct: boolean };
type Question = {
  id: string; text: string; explanation: string | null; source: string | null; origin: 'excel' | 'nuova';
  status: 'bozza' | 'approvata'; module_id: string | null; lesson_id: string | null;
  question_options: Option[]; lessons: { title: string } | null; modules: { title: string } | null;
};
type Draft = { text: string; explanation: string; source: string; options: string[]; correct: number };

const originLabel = { excel: 'Excel originale', nuova: 'Nuova' };
const PAGE = 40;

// CSV con intestazione: Domanda; Risposta 1…6; Corretta (numero della risposta); Spiegazione; Fonte.
// Separatore ; oppure , (rilevato dalla prima riga); campi tra virgolette ammessi.
function parseCsv(text: string): Draft[] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) >= (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { rows.at(-1)!.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.at(-1)!.push(cell); cell = ''; rows.push([]);
    } else cell += ch;
  }
  rows.at(-1)!.push(cell);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const col = (re: RegExp) => head.findIndex((h) => re.test(h.trim().toLowerCase()));
  const q = col(/^domanda/), ok = col(/corrett/), ex = col(/spiegaz/), src = col(/^fonte/);
  const answers = head.map((h, i) => (/^risposta/i.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
  return body.map((r) => {
    const slots = answers.map((i) => (r[i] ?? '').trim());
    const correctSlot = Number(r[ok]) - 1;
    const options = slots.filter(Boolean);
    return {
      text: (r[q] ?? '').trim(), explanation: (r[ex] ?? '').trim(), source: (r[src] ?? '').trim(),
      options, correct: slots[correctSlot] ? options.indexOf(slots[correctSlot]) : -1,
    };
  });
}

const problems = (d: Draft) => [
  !d.text && 'testo mancante',
  d.options.length < 2 && 'meno di 2 risposte',
  (d.correct < 0 || d.correct >= d.options.length) && 'risposta corretta mancante',
].filter(Boolean) as string[];

function Editor({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => void; onCancel?: () => void }) {
  const [d, setD] = useState(initial);
  const issues = problems(d);
  return (
    <div className="space-y-3">
      <textarea className={inputCls} rows={2} placeholder="Testo della domanda" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} aria-label="Testo della domanda" />
      {d.options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="radio" name="corretta" checked={d.correct === i} onChange={() => setD({ ...d, correct: i })} aria-label={`Risposta ${i + 1} corretta`} />
          <input className={inputCls} value={o} placeholder={`Risposta ${i + 1}`} aria-label={`Risposta ${i + 1}`}
                 onChange={(e) => setD({ ...d, options: d.options.map((x, j) => (j === i ? e.target.value : x)) })} />
          <button type="button" className={btn.ghost} aria-label="Togli risposta" disabled={d.options.length <= 2}
                  onClick={() => setD({ ...d, options: d.options.filter((_, j) => j !== i), correct: d.correct === i ? -1 : d.correct > i ? d.correct - 1 : d.correct })}>✕</button>
        </div>
      ))}
      <button type="button" className={btn.ghost} disabled={d.options.length >= 6} onClick={() => setD({ ...d, options: [...d.options, ''] })}>+ Risposta</button>
      <textarea className={inputCls} rows={2} placeholder="Spiegazione (facoltativa)" value={d.explanation} onChange={(e) => setD({ ...d, explanation: e.target.value })} aria-label="Spiegazione" />
      <input className={inputCls} placeholder="Fonte (facoltativa)" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })} aria-label="Fonte" />
      {issues.length > 0 && <p className="text-sm text-warn">Da completare: {issues.join(', ')}.</p>}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={issues.length > 0} onClick={() => onSave({ ...d, options: d.options.map((o) => o.trim()) })}>Salva</button>
        {onCancel && <button type="button" className={btn.ghost} onClick={onCancel}>Annulla</button>}
      </div>
    </div>
  );
}

const toDraft = (q: Question): Draft => {
  const opts = [...q.question_options].sort((a, b) => a.position - b.position);
  return { text: q.text, explanation: q.explanation ?? '', source: q.source ?? '', options: opts.map((o) => o.text), correct: opts.findIndex((o) => o.is_correct) };
};

export default function Questions() {
  const libs = useRows<{ id: string; name: string }>(() => supabase.from('lesson_libraries').select('id, name').order('name'));
  const [lib, setLib] = useState('');
  const libId = lib || libs.rows?.[0]?.id || '';
  const qs = useRows<Question>(() => !libId ? Promise.resolve({ data: null, error: null })
    : supabase.from('questions').select('*, question_options(*), lessons(title), modules(title)').eq('library_id', libId).order('created_at'), [libId]);
  const [filter, setFilter] = useState({ status: '', origin: '', area: '', q: '' });
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [csv, setCsv] = useState<Draft[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const report = (error: { message: string } | null | undefined, ok: string) => {
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: ok });
    if (!error) qs.reload();
    return !error;
  };

  const all = qs.rows ?? [];
  const areaOf = (q: Question) => q.modules?.title ?? 'Generali (senza lezione)';
  const list = useMemo(() => all.filter((q) =>
    (!filter.status || q.status === filter.status) && (!filter.origin || q.origin === filter.origin)
    && (!filter.area || areaOf(q) === filter.area)
    && (!filter.q || `${q.text} ${q.lessons?.title ?? ''}`.toLowerCase().includes(filter.q.toLowerCase()))), [all, filter]);

  // Distribuzione per area (e per lezione dentro l'area).
  const dist = useMemo(() => {
    const m = new Map<string, { tot: number; ok: number; lessons: Map<string, number> }>();
    for (const q of all) {
      const a = m.get(areaOf(q)) ?? { tot: 0, ok: 0, lessons: new Map() };
      a.tot++; if (q.status === 'approvata') a.ok++;
      if (q.lessons) a.lessons.set(q.lessons.title, (a.lessons.get(q.lessons.title) ?? 0) + 1);
      m.set(areaOf(q), a);
    }
    return [...m.entries()].sort();
  }, [all]);

  const setStatus = async (ids: string[], status: Question['status']) => {
    const { error } = await supabase.from('questions')
      .update({ status, approved_at: status === 'approvata' ? new Date().toISOString() : null }).in('id', ids);
    report(error, status === 'approvata' ? `${ids.length} domande approvate.` : 'Domanda riportata in bozza.');
  };

  // Le opzioni si aggiornano per posizione, così gli id restano stabili per i tentativi in corso.
  const saveOptions = async (questionId: string, d: Draft) => {
    const { error } = await supabase.from('question_options').upsert(
      d.options.map((text, i) => ({ question_id: questionId, position: i + 1, text, is_correct: i === d.correct })),
      { onConflict: 'question_id,position' });
    if (error) return error;
    return (await supabase.from('question_options').delete().eq('question_id', questionId).gt('position', d.options.length)).error;
  };

  const save = async (q: Question, d: Draft) => {
    const { error } = await supabase.from('questions')
      .update({ text: d.text, explanation: d.explanation || null, source: d.source || null }).eq('id', q.id);
    if (report(error ?? (await saveOptions(q.id, d)), 'Domanda salvata.')) setEditing(null);
  };

  const insert = async (drafts: Draft[]) => {
    for (const d of drafts) {
      const { data, error } = await supabase.from('questions')
        .insert({ library_id: libId, text: d.text, explanation: d.explanation || null, source: d.source || null, origin: 'nuova' })
        .select('id').single();
      const err = error ?? (await saveOptions(data!.id, d));
      if (err) return report(err, '');
    }
    return report(null, `${drafts.length} domande aggiunte in bozza.`);
  };

  const remove = async (q: Question) => {
    if (!confirm('Eliminare questa domanda?')) return;
    report((await supabase.from('questions').delete().eq('id', q.id)).error, 'Domanda eliminata.');
  };

  const readCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setCsv(parseCsv(await f.text()));
    e.target.value = '';
  };

  const drafts = list.filter((q) => q.status === 'bozza').map((q) => q.id);
  const csvOk = csv?.filter((d) => problems(d).length === 0) ?? [];

  return (
    <>
      <PageTitle title="Banco domande" sub="Le domande in bozza non entrano nei test finché non vengono approvate. Le soluzioni sono visibili solo agli Admin." />
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {qs.error && <Message kind="error">{qs.error}</Message>}

      <Panel title="Distribuzione" actions={
        <select className={`${inputCls} w-auto`} value={libId} onChange={(e) => setLib(e.target.value)} aria-label="Libreria">
          {libs.rows?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      }>
        <p className="mb-3 text-sm text-ink-muted">
          {all.length} domande · {all.filter((q) => q.status === 'approvata').length} approvate.
          Il test di ogni corso pesca solo dalle domande generali e da quelle delle sue lezioni.
        </p>
        <ul className="divide-y divide-line">
          {dist.map(([area, a]) => (
            <li key={area} className="py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap justify-between gap-2">
                  <span className="font-medium">{area}</span>
                  <span className="text-sm tabular-nums text-ink-muted">{a.tot} domande · {a.ok} approvate</span>
                </summary>
                {a.lessons.size > 0 && (
                  <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {[...a.lessons.entries()].map(([l, n]) => <li key={l} className="flex justify-between gap-2"><span className="truncate" title={l}>{l}</span><span className="tabular-nums text-ink-muted">{n}</span></li>)}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mb-4 flex flex-wrap gap-2">
        <button className={btn.primary} onClick={() => setAdding(!adding)}>Nuova domanda</button>
        <label className={`${btn.ghost} cursor-pointer`}>
          Importa CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={readCsv} />
        </label>
      </div>

      {adding && (
        <Panel title="Nuova domanda">
          <Editor initial={{ text: '', explanation: '', source: '', options: ['', '', ''], correct: -1 }}
                  onSave={async (d) => { if (await insert([d])) setAdding(false); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      {csv && (
        <Panel title="Anteprima importazione CSV" actions={
          <div className="flex gap-2">
            <button className={btn.primary} disabled={!csvOk.length} onClick={async () => { if (await insert(csvOk)) setCsv(null); }}>Importa {csvOk.length} in bozza</button>
            <button className={btn.ghost} onClick={() => setCsv(null)}>Annulla</button>
          </div>
        }>
          <p className="mb-3 text-sm text-ink-muted">{csv.length} righe lette · {csv.length - csvOk.length} da correggere (non verranno importate).</p>
          <ol className="divide-y divide-line">
            {csv.map((d, i) => {
              const p = problems(d);
              return (
                <li key={i} className="py-2">
                  <p className="font-medium">{i + 1}. {d.text || <em>senza testo</em>} {p.length > 0 && <Badge tone="bad">{p.join(', ')}</Badge>}</p>
                  <ul className="ml-5 list-disc text-sm">{d.options.map((o, j) => <li key={j} className={j === d.correct ? 'font-semibold text-success' : ''}>{o}{j === d.correct && ' ✓'}</li>)}</ul>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      <Panel>
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <input className={inputCls} placeholder="Cerca nel testo o nella lezione" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Cerca" />
          <select className={inputCls} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Stato">
            <option value="">Tutti gli stati</option><option value="bozza">Bozza</option><option value="approvata">Approvata</option>
          </select>
          <select className={inputCls} value={filter.origin} onChange={(e) => setFilter({ ...filter, origin: e.target.value })} aria-label="Origine">
            <option value="">Tutte le origini</option><option value="excel">Excel originale</option><option value="nuova">Nuove</option>
          </select>
          <select className={inputCls} value={filter.area} onChange={(e) => setFilter({ ...filter, area: e.target.value })} aria-label="Area">
            <option value="">Tutte le aree</option>{dist.map(([a]) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-ink-muted">{list.length} domande</span>
          {drafts.length > 0 && (
            <button className={btn.ghost} onClick={() => confirm(`Approvare le ${drafts.length} domande in bozza mostrate?`) && setStatus(drafts, 'approvata')}>
              Approva le {drafts.length} in bozza mostrate
            </button>
          )}
        </div>
        {qs.rows && list.length === 0 && <Empty>Nessuna domanda.</Empty>}
        <ul className="divide-y divide-line">
          {list.slice(0, shown).map((q) => (
            <li key={q.id} className="py-4">
              {editing === q.id ? <Editor initial={toDraft(q)} onSave={(d) => save(q, d)} onCancel={() => setEditing(null)} /> : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={q.status === 'approvata' ? 'ok' : 'warn'}>{q.status === 'approvata' ? 'Approvata' : 'Bozza'}</Badge>
                    <Badge tone="muted">{originLabel[q.origin]}</Badge>
                    <span className="text-xs text-ink-muted">{q.lessons ? `${areaOf(q)} · ${q.lessons.title}` : q.source}</span>
                  </div>
                  <p className="font-medium">{q.text}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {[...q.question_options].sort((a, b) => a.position - b.position).map((o) => (
                      <li key={o.position} className={o.is_correct ? 'font-semibold text-success' : 'text-ink-muted'}>{o.is_correct ? '✓' : '·'} {o.text}</li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-sm"><span className="font-medium">Spiegazione:</span> {q.explanation}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className={btn.ghost} onClick={() => setStatus([q.id], q.status === 'approvata' ? 'bozza' : 'approvata')}>{q.status === 'approvata' ? 'Torna in bozza' : 'Approva'}</button>
                    <button className={btn.ghost} onClick={() => setEditing(q.id)}>Modifica</button>
                    <button className={btn.ghost} onClick={() => remove(q)}>Elimina</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {list.length > shown && <button className={`${btn.ghost} mt-3`} onClick={() => setShown(shown + PAGE)}>Mostra altre {Math.min(PAGE, list.length - shown)}</button>}
      </Panel>
    </>
  );
}
