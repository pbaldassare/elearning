// "Entra come": apre o chiude una sessione di impersonificazione.
// Solo un Admin verificato lato server; ogni apertura/chiusura finisce in audit_impersonation.
// Body: { action: 'start', target_id } | { action: 'stop' }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-act-as',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: 'Non autenticato' }, 401);

  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') return json({ error: 'Non autorizzato' }, 403);

  const { action, target_id } = await req.json().catch(() => ({}));
  if (action !== 'start' && action !== 'stop') return json({ error: 'Azione non valida' }, 400);

  let target = null;
  if (action === 'start') {
    const { data } = await db.from('profiles').select('id, role').eq('id', target_id).maybeSingle();
    if (!data || data.role === 'admin') return json({ error: 'Utente non impersonabile' }, 400);
    target = data;
  }

  // Una sola sessione aperta per Admin: chiude quelle precedenti.
  const { data: closed, error: closeError } = await db.from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('admin_id', user.id).is('ended_at', null)
    .select('target_id');
  if (closeError) return json({ error: closeError.message }, 500);

  const audit = (closed ?? []).map((s) => ({ admin_id: user.id, target_id: s.target_id, action: 'stop' }));

  if (target) {
    const { error } = await db.from('impersonation_sessions').insert({ admin_id: user.id, target_id: target.id });
    if (error) return json({ error: error.message }, 500);
    audit.push({ admin_id: user.id, target_id: target.id, action: 'start' });
  }

  if (audit.length) {
    const { error } = await db.from('audit_impersonation').insert(audit);
    if (error) return json({ error: error.message }, 500);
  }

  return json({ ok: true });
});
