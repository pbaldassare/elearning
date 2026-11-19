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

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'learning' } });
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: 'Non autenticato' }, 401);

  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') return json({ error: 'Non autorizzato' }, 403);

  const { action, target_id } = await req.json().catch(() => ({}));
  if (action !== 'start' && action !== 'stop') return json({ error: 'Azione non valida' }, 400);

  if (action === 'start' && (typeof target_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(target_id))) {
    return json({ error: 'Utente non impersonabile' }, 400);
  }
  const { error } = await db.rpc('set_impersonation', {
    p_admin: user.id, p_target: action === 'start' ? target_id : null,
  });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : error.code.startsWith('22') ? 400 : 500);
  return json({ ok: true });
});
