import { supabase } from '../../lib/supabase';
import { useRows } from '../../lib/useRows';
import { Empty, PageTitle, Panel } from '../../ui';

type Name = { first_name: string; last_name: string } | null;
const name = (p: Name) => (p ? `${p.first_name} ${p.last_name}` : '—');
const when = (d: string) => new Date(d).toLocaleString('it-IT');
const actions: Record<string, string> = { start: 'Entra come', stop: 'Esce' };

export default function Audit() {
  const audit = useRows<{ id: number; action: string; at: string; admin: Name; target: Name }>(() =>
    supabase.from('audit_impersonation')
      .select('id, action, at, admin:profiles!audit_impersonation_admin_id_fkey(first_name, last_name), target:profiles!audit_impersonation_target_id_fkey(first_name, last_name)')
      .order('at', { ascending: false }).limit(200));
  const access = useRows<{ id: number; at: string; ip: string | null; user_agent: string | null; profiles: Name }>(() =>
    supabase.from('access_logs').select('id, at, ip, user_agent, profiles(first_name, last_name)')
      .order('at', { ascending: false }).limit(200));

  return (
    <>
      <PageTitle title="Registro" sub="Ultimi 200 eventi. Il registro “Entra come” è visibile solo agli Admin." />
      <Panel title="Entra come">
        {audit.rows?.length === 0 && <Empty>Nessun evento.</Empty>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted"><tr><th className="py-2 pr-4">Quando</th><th className="pr-4">Admin</th><th className="pr-4">Utente</th><th>Azione</th></tr></thead>
            <tbody className="divide-y divide-line">
              {audit.rows?.map((r) => (
                <tr key={r.id}><td className="py-2 pr-4 whitespace-nowrap">{when(r.at)}</td><td className="pr-4">{name(r.admin)}</td><td className="pr-4">{name(r.target)}</td><td>{actions[r.action] ?? r.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Accessi">
        {access.rows?.length === 0 && <Empty>Nessun accesso registrato.</Empty>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted"><tr><th className="py-2 pr-4">Quando</th><th className="pr-4">Utente</th><th className="pr-4">IP</th><th>Dispositivo</th></tr></thead>
            <tbody className="divide-y divide-line">
              {access.rows?.map((r) => (
                <tr key={r.id}><td className="py-2 pr-4 whitespace-nowrap">{when(r.at)}</td><td className="pr-4">{name(r.profiles)}</td><td className="pr-4 font-mono">{r.ip}</td><td className="max-w-xs truncate" title={r.user_agent ?? ''}>{r.user_agent}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
