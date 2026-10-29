// Carica su Supabase gli argomenti in content/<libreria>/<area>/*.json.
// Uso: node scripts/load-content.mjs content/ivass/amministrativa
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD (scrive come Admin, con RLS).
//
// Ogni lezione nasce o resta in "bozza": l'approvazione si fa dal pannello Admin.
// Tempo minimo = parole (slide + testo narrato) / 120 parole al minuto.
// scope "core" = IVASS 30 e 60 ore; scope "60" = solo IVASS 60 ore; scope "privacy" = corso Privacy.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const WPM = 120;
const DEMO = ' – dimostrazione';
// Libreria dedotta dalla cartella content/<libreria>/<area>.
const LIBS = {
  ivass: {
    name: 'IVASS',
    modules: ['Area giuridica', 'Area tecnica assicurativa e riassicurativa', 'Area amministrativa e gestionale', 'Area informatica'],
    courses: { core: ['IVASS 30 ore', 'IVASS 60 ore', 'IVASS 30 ore' + DEMO, 'IVASS 60 ore' + DEMO], 60: ['IVASS 60 ore', 'IVASS 60 ore' + DEMO] },
  },
  privacy: {
    name: 'Privacy',
    modules: ['Il GDPR: quadro, definizioni e principi', 'Soggetti e adempimenti', 'Sicurezza, violazioni e sanzioni'],
    courses: { privacy: ['Privacy'] },
  },
};

const words = (o) =>
  typeof o === 'string' ? o.split(/\s+/).filter(Boolean).length
  : Array.isArray(o) ? o.reduce((n, x) => n + words(x), 0)
  : o && typeof o === 'object' ? Object.entries(o).reduce((n, [k, v]) => n + (['layout', 'answer'].includes(k) ? 0 : words(v)), 0)
  : 0;
export const minSeconds = (lesson) => Math.round(((words(lesson.slides) + words(lesson.narration)) / WPM) * 60);

async function main(dir) {
  const { name: LIBRARY, modules: MODULES, courses: COURSES } = LIBS[basename(dirname(resolve(dir)))];
  const env = Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)),
  );
  const get = (k) => process.env[k] ?? env[k];
  const db = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'), { db: { schema: 'learning' } });
  const { error: authError } = await db.auth.signInWithPassword({ email: get('ADMIN_EMAIL'), password: get('ADMIN_PASSWORD') });
  if (authError) throw authError;

  const one = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  const lib = await one(db.from('lesson_libraries').select('id').eq('name', LIBRARY).single());
  const courses = await one(db.from('courses').select('id, title').eq('library_id', lib.id));

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const t = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const position = MODULES.indexOf(t.module) + 1;
    if (!position) throw new Error(`${file}: area sconosciuta "${t.module}"`);
    const mod = await one(db.from('modules').upsert({ library_id: lib.id, position, title: t.module }, { onConflict: 'library_id,position' }).select('id').single());

    // Le lezioni di un argomento possono stare in più file (es. reclami + reclami-ascolto): l'ordine
    // è topic_order * 100 + lesson_order (default: indice nel file, sommato a lesson_offset).
    for (const [i, l] of t.lessons.entries()) {
      const pos = t.topic_order * 100 + (t.lesson_offset ?? 0) + i + 1;
      const row = {
        module_id: mod.id, position: pos, topic: t.topic, title: l.title,
        slides: l.slides, narration: l.narration, sources: l.sources ?? [], min_seconds: minSeconds(l),
      };
      const saved = await one(db.from('lessons').upsert(row, { onConflict: 'module_id,position' }).select('id').single());
      await one(db.from('content_changes').delete().eq('lesson_id', saved.id));
      if (l.changes?.length) await one(db.from('content_changes').insert(l.changes.map((c) => ({ ...c, lesson_id: saved.id }))));
      const wanted = courses.filter((c) => COURSES[t.scope].includes(c.title));
      await one(db.from('course_lessons').delete().eq('lesson_id', saved.id));
      await one(db.from('course_lessons').insert(wanted.map((c) => ({ course_id: c.id, lesson_id: saved.id }))));
      console.log(`${t.topic} › ${l.title}: ${Math.round(row.min_seconds / 60)} min (${t.scope})`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
