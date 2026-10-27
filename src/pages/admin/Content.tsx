import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useRows } from '../../lib/useRows';
import { Badge, btn, Empty, inputCls, Message, PageTitle, Panel } from '../../ui';

type Lesson = {
  id: string; title: string; position: number; topic: string | null; status: 'bozza' | 'approvata';
  min_seconds: number; content_changes: { count: number }[];
};
type Module = { id: string; title: string; position: number; lessons: Lesson[] };

export default function Content() {
  const libs = useRows<{ id: string; name: string }>(() => supabase.from('lesson_libraries').select('id, name').order('name'));
  const [lib, setLib] = useState('');
  const libId = lib || libs.rows?.[0]?.id || '';
  const mods = useRows<Module>(
    () => !libId ? Promise.resolve({ data: null, error: null }) : supabase.from('modules')
      .select('id, title, position, lessons(id, title, position, topic, status, min_seconds, content_changes(count))')
      .eq('library_id', libId).order('position').order('position', { referencedTable: 'lessons' }),
    [libId],
  );
  const [onlyDrafts, setOnlyDrafts] = useState(false);
  const [error, setError] = useState('');

  const setStatus = async (ids: string[], status: Lesson['status']) => {
    const { error } = await supabase.from('lessons')
      .update({ status, approved_at: status === 'approvata' ? new Date().toISOString() : null }).in('id', ids);
    setError(error?.message ?? '');
    mods.reload();
  };

  const all = mods.rows?.flatMap((m) => m.lessons) ?? [];
  const approved = all.filter((l) => l.status === 'approvata').length;

  return (
    <>
      <PageTitle title="Contenuti" sub="Le lezioni in bozza non sono visibili ai corsisti. Anteprima e tabella delle modifiche rispetto alla fonte sono nella pagina di revisione." />
      {(error || mods.error) && <Message kind="error">{error || mods.error}</Message>}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Libreria</span>
          <select className={inputCls} value={libId} onChange={(e) => setLib(e.target.value)}>
            {libs.rows?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={onlyDrafts} onChange={(e) => setOnlyDrafts(e.target.checked)} /> Solo bozze
        </label>
        <p className="pb-2 text-sm text-ink-muted">{approved} approvate su {all.length}</p>
      </div>

      {mods.rows?.length === 0 && <Empty>Questa libreria non ha ancora lezioni.</Empty>}
      {mods.rows?.map((m) => {
        const lessons = m.lessons.filter((l) => !onlyDrafts || l.status === 'bozza');
        const drafts = m.lessons.filter((l) => l.status === 'bozza').map((l) => l.id);
        return (
          <Panel key={m.id} title={m.title} actions={drafts.length > 0 && (
            <button className={btn.ghost} onClick={() => confirm(`Approvare ${drafts.length} lezioni di “${m.title}”?`) && setStatus(drafts, 'approvata')}>
              Approva tutte ({drafts.length})
            </button>
          )}>
            <ul className="divide-y divide-line">
              {lessons.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.title}</span>
                    <span className="text-xs text-ink-muted">
                      {l.topic} · {Math.round(l.min_seconds / 60)} min · {l.content_changes[0]?.count ?? 0} modifiche registrate
                    </span>
                  </span>
                  <Badge tone={l.status === 'approvata' ? 'ok' : 'warn'}>{l.status === 'approvata' ? 'Approvata' : 'Bozza'}</Badge>
                  <button className={btn.ghost} onClick={() => setStatus([l.id], l.status === 'approvata' ? 'bozza' : 'approvata')}>
                    {l.status === 'approvata' ? 'Torna in bozza' : 'Approva'}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </>
  );
}
