// Genera SQL autonomo (da incollare nell'SQL Editor, senza Node né chiavi) per un progetto Supabase:
//   2-lezioni-<n>-<area>.sql  moduli, lezioni approvate, modifiche rispetto alla fonte, lezioni per corso
//   4-domande.sql             banco domande in bozza: Excel originale + verifiche delle lezioni
// Uso: node scripts/build-sql.mjs <cartella di uscita> [ivass|privacy]     Tutti i file sono rieseguibili.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, which = 'ivass'] = process.argv.slice(2);
const { minSeconds } = await import(join(repo, 'scripts/load-content.mjs'));
const DEMO = ' – dimostrazione';
// prefix: rende unici i riferimenti delle domande tra librerie (IVASS resta senza prefisso).
const LIBS = {
  ivass: {
    name: 'IVASS', prefix: '', excel: 'test finale ivass 2023.xlsx',
    areas: ['contrattuale', 'giuridica', 'tecnica', 'amministrativa', 'informatica'],
    modules: ['Area contrattuale e prodotti', 'Area giuridica', 'Area tecnica assicurativa e riassicurativa', 'Area amministrativa e gestionale', 'Area informatica'],
    courses: { core: ['IVASS 30 ore', 'IVASS 60 ore', 'IVASS 30 ore' + DEMO, 'IVASS 60 ore' + DEMO], 60: ['IVASS 60 ore', 'IVASS 60 ore' + DEMO] },
  },
  privacy: {
    name: 'Privacy', prefix: 'privacy:', excel: 'test_corso_privacy_2024.xlsx',
    areas: ['1-quadro', '2-adempimenti', '3-sicurezza'],
    modules: ['Il GDPR: quadro, definizioni e principi', 'Soggetti e adempimenti', 'Sicurezza, violazioni e sanzioni'],
    courses: { privacy: ['Privacy', 'Privacy' + DEMO] },
  },
};
const L = LIBS[which];
const q = (v) => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const j = (v) => `${q(JSON.stringify(v ?? []))}::jsonb`;
const lib = `(select id from learning.lesson_libraries where name = ${q(L.name)})`;
const lessonId = (mp, pos) => `(select le.id from learning.lessons le join learning.modules m on m.id = le.module_id where m.library_id = ${lib} and m.position = ${mp} and le.position = ${pos})`;
let n = 0;
const questions = [];
L.areas.forEach((area, ai) => {
  const dir = join(repo, 'content', which, area);
  const sql = [`-- Lezioni ${L.name}, ${area}. Richiede setup.sql già eseguito. Rieseguibile.`, 'begin;'];
  const mpos = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const t = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const mp = L.modules.indexOf(t.module) + 1;
    if (!mp) throw new Error(`${file}: modulo sconosciuto "${t.module}"`);
    if (!mpos.has(mp)) {
      mpos.add(mp);
      sql.push(`insert into learning.modules (library_id, position, title) select ${lib}, ${mp}, ${q(t.module)} on conflict (library_id, position) do update set title = excluded.title;`);
    }
    const lid = (pos) => lessonId(mp, pos);
    t.lessons.forEach((l, i) => {
      const pos = t.topic_order * 100 + (t.lesson_offset ?? 0) + i + 1;
      n++;
      sql.push(`\n-- ${t.topic} › ${l.title}`,
        `insert into learning.lessons (module_id, position, topic, title, slides, narration, sources, min_seconds, status, approved_at)
select m.id, ${pos}, ${q(t.topic)}, ${q(l.title)}, ${j(l.slides)}, ${q(l.narration)}, ${j(l.sources)}, ${minSeconds(l)}, 'approvata', now()
from learning.modules m where m.library_id = ${lib} and m.position = ${mp}
on conflict (module_id, position) do update set topic = excluded.topic, title = excluded.title, slides = excluded.slides,
  narration = excluded.narration, sources = excluded.sources, min_seconds = excluded.min_seconds;`,
        `delete from learning.content_changes where lesson_id = ${lid(pos)};`);
      if (l.changes?.length) sql.push(`insert into learning.content_changes (lesson_id, kind, description, source_ref) values\n${l.changes.map((c) =>
        `  (${lid(pos)}, ${q(c.kind)}, ${q(c.description)}, ${q(c.source_ref)})`).join(',\n')};`);
      l.slides.forEach((sl, si) => sl.layout === 'quiz' && questions.push({
        ref: `${L.prefix}lezione:${mp}.${pos}:${si + 1}`, mp, pos, text: sl.question, explanation: sl.explanation,
        source: `Verifica della lezione «${l.title}»`, options: sl.options.map((o, i) => ({ text: o, correct: i === sl.answer })),
      }));
      sql.push(`insert into learning.course_lessons (course_id, lesson_id) select c.id, ${lid(pos)} from learning.courses c where c.title in (${L.courses[l.scope ?? t.scope].map(q).join(', ')}) on conflict do nothing;`);
    });
  }
  sql.push('commit;');
  writeFileSync(join(out, `2-lezioni-${ai + 1}-${area}.sql`), sql.join('\n') + '\n');
});
// Banco domande: tutte in bozza (le approva l'Admin). Reimportando non si cambia lo stato già deciso.
for (const x of JSON.parse(readFileSync(join(repo, 'content', which, 'domande-excel.json'), 'utf8'))) {
  questions.unshift({ ref: `${L.prefix}excel:${x.row}`, text: x.text, explanation: x.explanation ?? null, source: `${L.excel}, riga ${x.row}`, options: x.options, excel: true });
}
const qs = [`-- Banco domande ${L.name} (bozza). Richiede setup.sql e le lezioni. Rieseguibile.`, 'begin;'];
for (const x of questions) {
  const lesson = x.excel ? 'null' : lessonId(x.mp, x.pos);
  const mod = x.excel ? 'null' : `(select m.id from learning.modules m where m.library_id = ${lib} and m.position = ${x.mp})`;
  qs.push(`insert into learning.questions (library_id, module_id, lesson_id, text, explanation, source, origin, external_ref)
select ${lib}, ${mod}, ${lesson}, ${q(x.text)}, ${q(x.explanation)}, ${q(x.source)}, '${x.excel ? 'excel' : 'nuova'}', ${q(x.ref)}
on conflict (external_ref) do update set text = excluded.text, explanation = excluded.explanation, source = excluded.source, module_id = excluded.module_id, lesson_id = excluded.lesson_id;`,
    `delete from learning.question_options where question_id = (select id from learning.questions where external_ref = ${q(x.ref)});`,
    `insert into learning.question_options (question_id, position, text, is_correct) select id, v.p, v.t, v.c from learning.questions, (values ${x.options.map((o, i) => `(${i + 1}, ${q(o.text)}, ${o.correct})`).join(', ')}) v (p, t, c) where external_ref = ${q(x.ref)};`);
}
qs.push('commit;');
writeFileSync(join(out, '4-domande.sql'), qs.join('\n') + '\n');
console.log(n, 'lezioni,', questions.length, 'domande');
