// Scarica l'attestato PDF di un'iscrizione completata.
// Chi può vederlo lo decide la RLS (corsista, la sua azienda, Admin, "Entra come"): la lettura
// avviene con il token di chi chiama. Il modello lo legge solo la service role.
// Body: { enrollment_id }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fillCertificate } from './fill.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-act-as',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    db: { schema: 'learning' },
    global: { headers: { Authorization: `Bearer ${token}`, ...(req.headers.get('x-act-as') ? { 'x-act-as': req.headers.get('x-act-as')! } : {}) } },
  });
  const { enrollment_id } = await req.json().catch(() => ({}));
  const { data: c } = await asCaller.from('certificates')
    .select('serial, verify_code, is_demo, issued_at, enrollments(profiles(first_name, last_name, codice_fiscale), courses(required_hours, certificate_template_path))')
    .eq('enrollment_id', enrollment_id ?? '').order('issued_at', { ascending: false }).limit(1).maybeSingle();
  if (!c) return json({ error: 'Attestato non disponibile' }, 404);

  const e = c.enrollments as unknown as { profiles: { first_name: string; last_name: string; codice_fiscale: string | null }; courses: { required_hours: number; certificate_template_path: string | null } };
  const template = e.courses.certificate_template_path;
  if (!template) return json({ error: 'Modello di attestato non configurato per questo corso' }, 400);
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: file, error } = await db.storage.from('learning-attestati').download(template);
  if (error || !file) return json({ error: 'Modello di attestato mancante' }, 500);

  const pdf = await fillCertificate(new Uint8Array(await file.arrayBuffer()), {
    name: `${e.profiles.first_name} ${e.profiles.last_name}`.toUpperCase(),
    cf: e.profiles.codice_fiscale ?? '',
    date: new Date(c.issued_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }),
    hours: Number(e.courses.required_hours), serial: c.serial, code: c.verify_code, demo: c.is_demo, template,
  });
  return new Response(pdf, { headers: { ...cors, 'Content-Type': 'application/pdf' } });
});
