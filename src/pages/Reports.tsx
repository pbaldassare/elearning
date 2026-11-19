import { useMemo, useState } from 'react';
import { downloadCertificate, supabase } from '../lib/supabase';
import { useRows } from '../lib/useRows';
import { useAuth } from '../auth';
import { btn, Empty, fmtDate, fmtHours, inputCls, Message, PageTitle, Panel } from '../ui';

type Row = {
  id: string; company_id: string; course_id: string;
  last_name: string; first_name: string; codice_fiscale: string | null; email: string;
  company: string; course: string; status: string; expired: boolean;
  assigned_at: string; expires_at: string; completed_at: string | null;
  active_seconds: number; required_hours: number; lessons_done: number; lessons_total: number;
  confirmed_hours: number | null;
  attempts: number; best_score: number | null; certificate_serial: number | null; last_access: string | null; is_demo: boolean;
};

const statusLabel = (r: Row) => (r.expired ? 'Scaduto' : { assegnato: 'Assegnato', in_corso: 'In corso', completato: 'Completato' }[r.status] ?? r.status);
const mobileSummary = new Set(['Cognome', 'Nome', 'Corso', 'Stato', 'Scadenza']);

// Colonne condivise da tabella, CSV e stampa.
const cols: [string, (r: Row) => string][] = [
  ['Cognome', (r) => r.last_name],
  ['Nome', (r) => r.first_name],
  ['Codice fiscale', (r) => r.codice_fiscale ?? ''],
  ['Email', (r) => r.email],
  ['Azienda', (r) => r.company],
  ['Corso', (r) => r.course],
  ['Stato', statusLabel],
  ['Assegnato il', (r) => fmtDate(r.assigned_at)],
  ['Scadenza', (r) => fmtDate(r.expires_at)],
  ['Ore svolte', (r) => `${fmtHours(r.active_seconds)} / ${r.required_hours}`],
  ['Ore convalidate', (r) => r.confirmed_hours == null ? '' : String(r.confirmed_hours)],
  ['Lezioni', (r) => `${r.lessons_done} / ${r.lessons_total}`],
  ['Tentativi test', (r) => String(r.attempts)],
  ['Miglior punteggio', (r) => (r.best_score == null ? '' : `${r.best_score.toLocaleString('it-IT')}%`)],
  ['Esito convalida', (r) => r.confirmed_hours == null ? '' : 'Test superato'],
  ['Completato il', (r) => fmtDate(r.completed_at)],
  ['Attestato n.', (r) => (r.certificate_serial == null ? '' : String(r.certificate_serial))],
  ['Ultimo accesso', (r) => (r.last_access ? new Date(r.last_access).toLocaleString('it-IT') : '')],
];

// CSV per Excel italiano: separatore ";" e BOM per gli accenti.
function downloadCsv(rows: Row[]) {
  const cell = (value: string) => {
    const v = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
    return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const text = [cols.map(([h]) => h), ...rows.map((r) => cols.map(([, f]) => f(r)))].map((l) => l.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = `report-d-academy-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const { who } = useAuth();
  const isAdmin = who?.profile.role === 'admin';
  const { rows, error } = useRows<Row>(async () => {
    const all: Row[] = [];
    const pageSize = 250;
    let total: number | null = null;
    while (total === null || all.length < total) {
      const { data, error, count } = await supabase.from('report_enrollments')
        .select('*', all.length === 0 ? { count: 'exact' } : {})
        .order('last_name').order('first_name').order('id')
        .range(all.length, all.length + pageSize - 1);
      if (error) return { data: null, error };
      total ??= count;
      if (!data.length) break;
      all.push(...data as Row[]);
    }
    return { data: all, error: null };
  });
  const [company, setCompany] = useState('');
  const [course, setCourse] = useState('');
  const [q, setQ] = useState('');
  const [demo, setDemo] = useState(false);

  const options = (key: 'company' | 'course', id: 'company_id' | 'course_id') =>
    [...new Map((rows ?? []).map((r) => [r[id], r[key]])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (demo || !r.is_demo) && (!company || r.company_id === company) && (!course || r.course_id === course)
    && (!q || `${r.first_name} ${r.last_name} ${r.codice_fiscale ?? ''} ${r.email}`.toLowerCase().includes(q.toLowerCase()))),
  [rows, company, course, q, demo]);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const download = async (row: Row) => {
    setDownloadError('');
    setDownloading(row.id);
    try {
      await downloadCertificate(row.id, `attestato-${row.last_name}-${row.first_name}`);
    } catch (error) {
      setDownloadError((error as Error).message);
    } finally {
      setDownloading(null);
    }
  };
  const certificateButton = (row: Row) => row.certificate_serial != null && (
    <button className={`${btn.ghost} whitespace-nowrap`} disabled={downloading !== null} onClick={() => download(row)}>
      {downloading === row.id ? 'Download in corso…' : 'Scarica attestato'}
    </button>
  );

  return (
    <>
      <PageTitle title="Report" sub={isAdmin ? 'Iscrizioni di tutte le aziende.' : 'Iscrizioni dei tuoi corsisti.'} />
      {error && <Message kind="error">{error}</Message>}
      {downloadError && <Message kind="error">{downloadError}</Message>}
      <Panel>
        <div className="grid gap-3 print:hidden sm:grid-cols-2 lg:grid-cols-4">
          {isAdmin && (
            <select className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Azienda">
              <option value="">Tutte le aziende</option>
              {options('company', 'company_id').map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          )}
          <select className={inputCls} value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Corso">
            <option value="">Tutti i corsi</option>
            {options('course', 'course_id').map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <input className={inputCls} placeholder="Cerca corsista, codice fiscale o email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca corsista" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Includi account e corsi dimostrativi
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          <button className={btn.primary} disabled={!shown.length} onClick={() => downloadCsv(shown)}>Scarica CSV</button>
          <button className={btn.ghost} disabled={!shown.length} onClick={() => window.print()}>Stampa / Salva come PDF</button>
          <span className="text-sm text-ink-muted">{shown.length} iscrizioni{demo ? ' (comprese le dimostrative)' : ''}</span>
        </div>
        <p className="hidden text-sm print:block">D-Academy · report del {new Date().toLocaleString('it-IT')} · {shown.length} iscrizioni</p>
      </Panel>
      <Panel>
        {!rows && !error && <p role="status" className="text-sm text-ink-muted">Caricamento iscrizioni…</p>}
        {rows && !shown.length && <Empty>Nessuna iscrizione con questi filtri.</Empty>}
        {!!shown.length && (
          <ul className="divide-y divide-line md:hidden print:hidden">
            {shown.map((row) => (
              <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                <h2 className="break-words font-semibold">{row.last_name} {row.first_name}</h2>
                <p className="mt-1 text-sm">{row.course}</p>
                <p className="mt-1 text-sm text-ink-muted">{statusLabel(row)} · Scadenza {fmtDate(row.expires_at)}</p>
                {row.certificate_serial != null && <div className="mt-2">{certificateButton(row)}</div>}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-brand-strong">Dettagli iscrizione</summary>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    {cols.filter(([label]) => !mobileSummary.has(label)).map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-ink-muted">{label}</dt>
                        <dd className="break-words">{value(row) || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
        {!!shown.length && (
          <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
            <table className="w-full text-left text-sm print:text-[9px]">
              <thead className="text-ink-muted"><tr>{cols.map(([h]) => <th key={h} className="py-2 pr-3 whitespace-nowrap">{h}</th>)}<th className="print:hidden" /></tr></thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.id}>
                    {cols.map(([h, f]) => <td key={h} className="py-2 pr-3 whitespace-nowrap">{f(r)}</td>)}
                    <td className="print:hidden">
                      {certificateButton(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
