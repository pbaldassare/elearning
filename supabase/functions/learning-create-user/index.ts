// Crea un account (Azienda o Corsista) con la password standard (secret DEFAULT_PASSWORD o Vault).
// Admin: qualsiasi azienda, ruolo azienda o corsista. Azienda: solo corsisti propri.
// Rispetta "Entra come": il ruolo è quello effettivo (whoami con l'header x-act-as).
// Body: { role, company_id?, first_name, last_name, email, codice_fiscale?, is_demo? }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-act-as',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'learning' } });
  // Secret della funzione oppure, in sua assenza, segreto "default_password" in Supabase Vault.
  const password = Deno.env.get('DEFAULT_PASSWORD') ?? (await db.rpc('default_password')).data;
  if (!password) return json({ error: 'Password standard non configurata (secret DEFAULT_PASSWORD o Vault default_password)' }, 500);
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: 'Non autenticato' }, 401);

  // Identità effettiva calcolata dal DB, come per tutte le altre richieste.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    db: { schema: 'learning' },
    global: { headers: { Authorization: `Bearer ${token}`, ...(req.headers.get('x-act-as') ? { 'x-act-as': req.headers.get('x-act-as')! } : {}) } },
  });
  const { data: who } = await asCaller.rpc('whoami');
  const me = who?.profile;
  if (me?.role !== 'admin' && me?.role !== 'azienda') return json({ error: 'Non autorizzato' }, 403);

  const body = await req.json().catch(() => ({}));
  const role = me.role === 'azienda' ? 'corsista' : body.role;
  const company_id = me.role === 'azienda' ? me.company_id : body.company_id;
  if (role !== 'azienda' && role !== 'corsista') return json({ error: 'Ruolo non valido' }, 400);

  const { data: company } = await db.from('companies').select('id, is_demo, archived_at').eq('id', company_id).maybeSingle();
  if (!company || company.archived_at) return json({ error: 'Azienda non valida' }, 400);

  const first_name = String(body.first_name ?? '').trim();
  const last_name = String(body.last_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const codice_fiscale = String(body.codice_fiscale ?? '').trim().toUpperCase() || null;
  if (!first_name || !last_name || !email) return json({ error: 'Nome, cognome ed email sono obbligatori' }, 400);
  if (role === 'corsista' && !codice_fiscale) return json({ error: 'Il codice fiscale è obbligatorio' }, 400);
  if (codice_fiscale) {
    const { data: taken } = await db.from('profiles').select('id').eq('codice_fiscale', codice_fiscale).maybeSingle();
    if (taken) return json({ error: 'Codice fiscale già registrato' }, 409);
  }

  const { data: created, error: authError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) {
    const dup = /already|registered|exists/i.test(authError.message);
    return json({ error: dup ? 'Email già registrata' : authError.message }, dup ? 409 : 400);
  }

  const { error: profileError } = await db.from('profiles').insert({
    id: created.user.id, role, company_id, first_name, last_name, email, codice_fiscale,
    is_demo: company.is_demo || (me.role === 'admin' && body.is_demo === true),
  });
  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    const msg = /cf_valid|check/i.test(profileError.message) ? 'Codice fiscale non valido' : profileError.message;
    return json({ error: msg }, 400);
  }

  if (who.impersonating) {
    await db.from('audit_impersonation').insert({
      admin_id: user.id, target_id: me.id, action: 'insert profiles', details: { row: created.user.id },
    });
  }

  // ponytail: email di benvenuto non inviata finché non si sceglie il provider (SMTP/Resend).
  return json({ id: created.user.id, email_sent: false });
});
