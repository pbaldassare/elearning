-- Test permessi per ruolo e "Entra come". Eseguito da tests/db/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login(uid uuid, act_as uuid default null, ua text default 'test-agent') returns void
language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', uid)::text, true),
         set_config('request.headers', jsonb_strip_nulls(jsonb_build_object(
           'x-act-as', act_as, 'user-agent', ua, 'x-forwarded-for', '203.0.113.7, 10.0.0.1'))::text, true);
$$;

create function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALLITO: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create function tests.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FALLITO (doveva dare errore): %', msg;
exception when others then
  if sqlerrm like 'FALLITO%' then raise; end if;
  raise notice 'ok - % (%)', msg, sqlerrm;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------- dati di prova

\set admin    '''00000000-0000-0000-0000-0000000000ad'''
\set az_a     '''00000000-0000-0000-0000-0000000000a1'''
\set az_b     '''00000000-0000-0000-0000-0000000000b1'''
\set cors_a   '''00000000-0000-0000-0000-0000000000a2'''
\set cors_b   '''00000000-0000-0000-0000-0000000000b2'''
\set comp_a   '''00000000-0000-0000-0000-00000000c00a'''
\set comp_b   '''00000000-0000-0000-0000-00000000c00b'''

insert into auth.users (id, email) values
  (:admin, 'admin@test'), (:az_a, 'a@test'), (:az_b, 'b@test'), (:cors_a, 'ca@test'), (:cors_b, 'cb@test');
insert into learning.companies (id, name) values (:comp_a, 'Azienda A'), (:comp_b, 'Azienda B');
insert into learning.profiles (id, role, company_id, first_name, last_name, codice_fiscale, email) values
  (:admin,  'admin',    null,    'Ada',   'Admin',   null,               'admin@test'),
  (:az_a,   'azienda',  :comp_a, 'Referente', 'A',   null,               'a@test'),
  (:az_b,   'azienda',  :comp_b, 'Referente', 'B',   null,               'b@test'),
  (:cors_a, 'corsista', :comp_a, 'Mario', 'Rossi',   'RSSMRA85T10A562S', 'ca@test'),
  (:cors_b, 'corsista', :comp_b, 'Laura', 'Bianchi', 'BNCLRA90A41H501F', 'cb@test');

select id as c30 from learning.courses where title = 'IVASS 30 ore' \gset
select id as c60 from learning.courses where title = 'IVASS 60 ore' \gset

insert into learning.company_courses (company_id, course_id)
select :comp_a, id from learning.courses where title = 'IVASS 30 ore';
insert into learning.enrollments (user_id, course_id)
select :cors_a, id from learning.courses where title = 'IVASS 30 ore';

insert into learning.modules (library_id, position, title)
select id, 1, 'Area giuridica' from learning.lesson_libraries where name = 'IVASS';
insert into learning.lessons (module_id, position, title, status)
select id, 1, 'Lezione approvata', 'approvata' from learning.modules where title = 'Area giuridica';
insert into learning.lessons (module_id, position, title)
select id, 2, 'Lezione in bozza' from learning.modules where title = 'Area giuridica';

-- ---------------------------------------------------------------- codice fiscale

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'x@test');

select tests.ok(learning_private.cf_valid('RSSMRA85T10A562S'), 'CF valido accettato');
select tests.ok(learning_private.cf_valid('RSSMRA85T10A56NH'), 'CF omocodico valido accettato');
select tests.ok(not learning_private.cf_valid('RSSMRA85T10A562X'), 'CF con carattere di controllo errato rifiutato');
select tests.ok(not learning_private.cf_valid('rssmra85t10a562s'), 'CF minuscolo rifiutato');
select tests.fails($$insert into learning.profiles (id, role, company_id, first_name, last_name, codice_fiscale, email)
  values ('00000000-0000-0000-0000-0000000000ff', 'corsista', '00000000-0000-0000-0000-00000000c00a', 'X', 'Y', 'RSSMRA85T10A562S', 'x@test')$$,
  'CF duplicato rifiutato');
select tests.fails($$insert into learning.profiles (id, role, company_id, first_name, last_name, email)
  values ('00000000-0000-0000-0000-0000000000ff', 'corsista', '00000000-0000-0000-0000-00000000c00a', 'X', 'Y', 'x@test')$$,
  'corsista senza CF rifiutato');

-- ---------------------------------------------------------------- anon

begin;
set local role anon;
select tests.ok((select count(*) from learning.companies) = 0, 'anonimo: nessuna azienda');
select tests.ok((select count(*) from learning.profiles) = 0, 'anonimo: nessun profilo');
select tests.ok((select count(*) from learning.courses) = 0, 'anonimo: nessun corso');
rollback;

-- ---------------------------------------------------------------- admin

begin;
select tests.login(:admin);
set local role authenticated;
select tests.ok((select count(*) from learning.companies) = 2, 'admin: vede tutte le aziende');
select tests.ok((select count(*) from learning.profiles) = 5, 'admin: vede tutti i profili');
select tests.ok((select count(*) from learning.courses) = 5, 'admin: vede tutti i corsi');
select tests.ok((select count(*) from learning.lessons) = 2, 'admin: vede anche le bozze');
rollback;

-- ---------------------------------------------------------------- azienda

begin;
select tests.login(:az_a);
set local role authenticated;
select tests.ok((select array_agg(name) from learning.companies) = array['Azienda A'], 'azienda A: vede solo sé stessa');
select tests.ok((select count(*) from learning.profiles) = 2, 'azienda A: vede sé e i propri corsisti');
select tests.ok(not exists (select 1 from learning.profiles where id = :cors_b), 'azienda A: non vede corsisti di B');
select tests.ok((select count(*) from learning.enrollments) = 1, 'azienda A: vede le iscrizioni dei propri corsisti');
select tests.ok((select array_agg(title) from learning.courses) = array['IVASS 30 ore'], 'azienda A: vede solo i corsi assegnati');
select tests.ok((select count(*) from learning.audit_impersonation) = 0, 'azienda A: registro impersonificazione invisibile');
select tests.ok((select count(*) from learning.questions) = 0, 'azienda A: banco domande invisibile');
select tests.fails(format('insert into learning.enrollments (user_id, course_id) values (%L, %L)', :cors_a, :'c60'),
  'azienda A: non assegna corsi che non le sono stati assegnati');
select tests.fails(format('insert into learning.enrollments (user_id, course_id) values (%L, %L)', :cors_b, :'c30'),
  'azienda A: non assegna corsi a corsisti di B');
select tests.fails($$update learning.profiles set company_id = '00000000-0000-0000-0000-00000000c00b'
  where id = '00000000-0000-0000-0000-0000000000a2'$$, 'azienda A: non sposta corsisti di azienda');
select tests.fails($$update learning.profiles set codice_fiscale = 'VRDGPP80B01F205W'
  where id = '00000000-0000-0000-0000-0000000000a2'$$, 'azienda A: non cambia il codice fiscale');
update learning.profiles set first_name = 'Marco' where id = :cors_a;
select tests.ok((select first_name from learning.profiles where id = :cors_a) = 'Marco', 'azienda A: modifica il nome del proprio corsista');
with u as (update learning.profiles set first_name = 'Hack' where id = :cors_b returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non modifica corsisti di B');
with u as (update learning.enrollments set expires_at = now() + interval '1 year' returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non proroga le scadenze');
rollback;

-- Azienda assegna un corso che le è stato assegnato: la scadenza la decide il corso.
begin;
insert into learning.company_courses (company_id, course_id)
select :comp_a, id from learning.courses where title = 'IVASS 60 ore';
select tests.login(:az_a);
set local role authenticated;
insert into learning.enrollments (user_id, course_id, expires_at)
select :cors_a, id, now() + interval '10 years' from learning.courses where title = 'IVASS 60 ore';
select tests.ok(
  (select expires_at::date = (now() + interval '30 days')::date from learning.enrollments e
   join learning.courses c on c.id = e.course_id where c.title = 'IVASS 60 ore'),
  'azienda A: assegna al proprio corsista, scadenza forzata a 30 giorni');
rollback;

begin;
select tests.login(:az_b);
set local role authenticated;
select tests.ok((select count(*) from learning.enrollments) = 0, 'azienda B: non vede iscrizioni di A');
select tests.ok((select count(*) from learning.courses) = 0, 'azienda B: nessun corso assegnato');
rollback;

-- ---------------------------------------------------------------- corsista

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((select count(*) from learning.profiles) = 1, 'corsista: vede solo il proprio profilo');
select tests.ok((select count(*) from learning.companies) = 1, 'corsista: vede la propria azienda');
select tests.ok((select array_agg(title) from learning.courses) = array['IVASS 30 ore'], 'corsista: vede solo i corsi assegnati');
select tests.ok((select array_agg(title) from learning.lessons) = array['Lezione approvata'], 'corsista: non vede le lezioni in bozza');
select tests.ok((select count(*) from learning.question_options) = 0, 'corsista: non vede le risposte del banco');
select tests.ok((select count(*) from learning.app_config) > 0, 'corsista: legge la configurazione');
select tests.fails($$insert into learning.lesson_progress (enrollment_id, lesson_id)
  select e.id, l.id from learning.enrollments e, learning.lessons l limit 1$$, 'corsista: non scrive i progressi direttamente');
with u as (update learning.app_config set value = 'true' where key = 'force_password_change' returning 1)
select tests.ok((select count(*) from u) = 0, 'corsista: non modifica la configurazione');
select tests.ok(not (select learning.is_expired(e) from learning.enrollments e), 'corsista: corso non scaduto');
select learning.log_access();
select tests.ok((select ip = '203.0.113.7' and user_agent = 'test-agent' from learning.access_logs), 'corsista: accesso registrato con IP e dispositivo');
select tests.ok((learning.whoami() -> 'profile' ->> 'id')::uuid = :cors_a, 'whoami: profilo del corsista');
select tests.ok(not (learning.whoami() ->> 'force_password_change')::boolean, 'cambio password non imposto di default');
rollback;

begin;
update learning.app_config set value = 'true' where key = 'force_password_change';
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((learning.whoami() ->> 'force_password_change')::boolean, 'interruttore attivo: cambio password richiesto');
select learning.mark_password_changed();
select tests.ok(not (learning.whoami() ->> 'force_password_change')::boolean, 'dopo il cambio non è più richiesto');
rollback;

begin;
update learning.enrollments set expires_at = now() - interval '1 day';
select tests.ok((select learning.is_expired(e) from learning.enrollments e), 'iscrizione oltre la scadenza risulta scaduta');
rollback;

-- ---------------------------------------------------------------- "Entra come"

begin;
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select count(*) from learning.profiles) = 5, 'header senza sessione aperta: ignorato');
rollback;

begin;
insert into learning.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select array_agg(id) from learning.profiles) = array[:cors_a::uuid], 'admin come corsista: vede solo ciò che vede il corsista');
select tests.ok((select array_agg(title) from learning.lessons) = array['Lezione approvata'], 'admin come corsista: niente bozze');
select tests.ok((learning.whoami() ->> 'impersonating')::boolean, 'whoami: segnala l''impersonificazione all''admin');
select tests.ok((learning.whoami() -> 'profile' ->> 'role') = 'corsista', 'whoami: ruolo effettivo corsista');
select tests.fails('select learning_private.assert_not_impersonating()', 'admin come corsista: azioni formali bloccate');
select tests.fails('select learning.mark_password_changed()', 'admin come corsista: non tocca la password');
select learning.log_access();
select tests.ok((select count(*) from learning.access_logs) = 0, 'admin come corsista: nessun accesso registrato a nome del corsista');
select tests.ok((select count(*) from learning.audit_impersonation) = 0, 'registro leggibile dall''admin reale (vuoto)');
rollback;

begin;
insert into learning.impersonation_sessions (admin_id, target_id) values (:admin, :az_a);
insert into learning.company_courses (company_id, course_id)
select :comp_a, id from learning.courses where title = 'IVASS 60 ore';
select tests.login(:admin, :az_a);
set local role authenticated;
select tests.ok((select count(*) from learning.profiles) = 2, 'admin come azienda A: vede i dati di A');
insert into learning.enrollments (user_id, course_id)
select :cors_a, id from learning.courses where title = 'IVASS 60 ore';
select tests.ok((select count(*) from learning.audit_impersonation where action = 'insert enrollments') = 1,
  'admin come azienda A: assegnazione registrata nel registro tecnico');
reset role;
select tests.ok((select admin_id = :admin::uuid and target_id = :az_a::uuid from learning.audit_impersonation),
  'registro: admin reale e utente impersonato');
rollback;

begin;
insert into learning.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
update learning.impersonation_sessions set ended_at = now();
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select count(*) from learning.profiles) = 5, 'sessione chiusa: torna admin');
rollback;

begin;
insert into learning.impersonation_sessions (admin_id, target_id) values (:az_a, :cors_b);
select tests.login(:az_a, :cors_b);
set local role authenticated;
select tests.ok(not exists (select 1 from learning.profiles where id = :cors_b), 'non admin con sessione e header: ignorato');
rollback;

begin;
select tests.login(:cors_a, :admin);
set local role authenticated;
select tests.ok((select count(*) from learning.profiles) = 1, 'corsista con header verso admin: ignorato');
select tests.ok((select count(*) from learning.audit_impersonation) = 0, 'corsista: registro invisibile');
rollback;

-- ---------------------------------------------------------------- lezioni per corso

insert into learning.course_lessons (course_id, lesson_id)
select c.id, l.id from learning.courses c, learning.lessons l where c.title in ('IVASS 30 ore', 'IVASS 60 ore');

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((select count(distinct course_id) from learning.course_lessons) = 1, 'corsista: vede le lezioni solo del proprio corso');
rollback;

begin;
select tests.login(:az_b);
set local role authenticated;
select tests.ok((select count(*) from learning.course_lessons) = 0, 'azienda B: nessuna lezione di corsi non assegnati');
with u as (insert into learning.course_lessons select course_id, lesson_id from learning.course_lessons returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda B: non modifica le lezioni dei corsi');
rollback;

-- ---------------------------------------------------------------- assegnazioni e spostamenti

begin;
select tests.login(:az_a);
set local role authenticated;
select tests.fails(format('insert into learning.enrollments (user_id, course_id) values (%L, %L)', :cors_b, :'c30'),
  'azienda A: non iscrive corsisti di B');
select tests.fails(format('insert into learning.enrollments (user_id, course_id) values (%L, %L)', :cors_a, :'c60'),
  'azienda A: non assegna corsi non suoi');
with u as (update learning.enrollments set expires_at = now() + interval '1 year' where user_id = :cors_a returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non proroga');
rollback;

begin;
select tests.login(:admin);
set local role authenticated;
update learning.profiles set company_id = :comp_b where id = :cors_a;
select tests.ok((select company_id = :comp_b::uuid from learning.enrollments where user_id = :cors_a),
  'spostamento: le iscrizioni seguono il corsista');
select tests.login(:az_a);
select tests.ok(not exists (select 1 from learning.enrollments where user_id = :cors_a), 'spostamento: la vecchia azienda non vede più');
rollback;

-- ---------------------------------------------------------------- player e ore

insert into learning.lessons (module_id, position, title, status, min_seconds)
select id, 3, 'Seconda approvata', 'approvata', 30 from learning.modules where title = 'Area giuridica';
insert into learning.course_lessons (course_id, lesson_id)
select :'c30', id from learning.lessons where title = 'Seconda approvata';
update learning.lessons set min_seconds = 20 where title = 'Lezione approvata';
select id as l1 from learning.lessons where title = 'Lezione approvata' \gset
select id as l2 from learning.lessons where title = 'Seconda approvata' \gset
select id as e1 from learning.enrollments where user_id = :cors_a \gset

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.fails(format('select learning.heartbeat(%L, %L)', :'e1', :'l2'), 'player: lezione successiva bloccata');
select tests.fails(format('select learning.complete_lesson(%L, %L)', :'e1', :'l1'), 'player: non completa prima del tempo minimo');
select tests.fails(format('insert into learning.lesson_progress (enrollment_id, lesson_id, completed_at) values (%L, %L, now())', :'e1', :'l2'),
  'player: niente scritture dirette sul progresso');
reset role;
insert into learning.activity_heartbeats (enrollment_id, lesson_id, at) values (:'e1', :'l1', now() - interval '25 seconds');
set local role authenticated;
select tests.ok((learning.heartbeat(:'e1', :'l1') ->> 'lesson_seconds')::int = 25, 'heartbeat: accredita il tempo dal precedente');
select tests.ok((select status = 'in_corso' and active_seconds = 25 from learning.enrollments where id = :'e1'), 'heartbeat: ore sull''iscrizione, stato in corso');
select learning.complete_lesson(:'e1', :'l1');
select tests.ok((learning.heartbeat(:'e1', :'l2') ->> 'total_seconds')::int = 25, 'player: completata la prima, si sblocca la seconda');
rollback;

begin;
reset role;
insert into learning.activity_heartbeats (enrollment_id, lesson_id, at) values (:'e1', :'l1', now() - interval '5 minutes');
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((learning.heartbeat(:'e1', :'l1') ->> 'lesson_seconds')::int = 0, 'heartbeat: dopo una pausa non accredita nulla');
rollback;

begin;
select tests.login(:cors_b);
set local role authenticated;
select tests.fails(format('select learning.heartbeat(%L, %L)', :'e1', :'l1'), 'heartbeat: non sull''iscrizione di altri');
rollback;

begin;
insert into learning.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.fails(format('select learning.heartbeat(%L, %L)', :'e1', :'l1'), 'entra come: niente ore sul corso vero');
select tests.fails(format('select learning.complete_lesson(%L, %L)', :'e1', :'l1'), 'entra come: niente completamenti sul corso vero');
reset role;
update learning.courses set is_demo = true where id = :'c30';
set local role authenticated;
select learning.complete_lesson(:'e1', :'l1');
select learning.complete_lesson(:'e1', :'l2');
select tests.ok((select count(*) from learning.lesson_progress where enrollment_id = :'e1' and completed_at is not null) = 2,
  'corso dimostrativo: si avanza senza attese anche con entra come');
select tests.ok((select active_seconds = 0 from learning.enrollments where id = :'e1'), 'corso dimostrativo: nessuna ora accreditata');
rollback;

begin;
reset role;
update learning.enrollments set expires_at = now() - interval '1 day' where id = :'e1';
select tests.login(:cors_a);
set local role authenticated;
select tests.fails(format('select learning.heartbeat(%L, %L)', :'e1', :'l1'), 'corso scaduto: bloccato');
rollback;

-- ---------------------------------------------------------------- test finale

insert into learning.lessons (module_id, position, title, status)
select id, 4, 'Solo 60 ore', 'approvata' from learning.modules where title = 'Area giuridica';
insert into learning.course_lessons (course_id, lesson_id) select :'c60', id from learning.lessons where title = 'Solo 60 ore';
select id as l3 from learning.lessons where title = 'Solo 60 ore' \gset
\set q1 '''00000000-0000-0000-0000-0000000000e1'''
\set q2 '''00000000-0000-0000-0000-0000000000e2'''
\set q3 '''00000000-0000-0000-0000-0000000000e3'''
insert into learning.questions (id, library_id, lesson_id, text, origin, status)
select v.id::uuid, l.id, v.lesson::uuid, v.t, 'excel', 'approvata'
from learning.lesson_libraries l, (values (:q1, null, 'Domanda generale'), (:q2, :'l1', 'Domanda lezione 1'), (:q3, :'l3', 'Domanda solo 60')) v (id, lesson, t)
where l.name = 'IVASS';
insert into learning.question_options (question_id, position, text, is_correct) values
  (:q1, 1, 'giusta', true), (:q1, 2, 'sbagliata', false),
  (:q2, 1, 'giusta', true), (:q2, 2, 'sbagliata', false),
  (:q3, 1, 'giusta', true);
update learning.courses set quiz_questions_drawn = 2, quiz_max_attempts = 2, quiz_minutes_per_question = 5 where id = :'c30';
select tests.ok((select count(*) from learning_private.quiz_pool(:'c30')) = 2, 'banco 30 ore: esclude le domande delle lezioni solo 60 ore');
select tests.ok((select count(*) from learning_private.quiz_pool(:'c60')) = 3, 'banco 60 ore: include tutto');
select id as ok1 from learning.question_options where question_id = :q1 and is_correct \gset
select id as ok2 from learning.question_options where question_id = :q2 and is_correct \gset
select id as ko1 from learning.question_options where question_id = :q1 and not is_correct \gset

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.fails(format('select learning.start_quiz(%L)', :'e1'), 'test: bloccato senza lezioni completate');
select tests.ok((select count(*) from learning.question_options) = 0, 'test: il corsista non legge le risposte corrette');
reset role;
insert into learning.lesson_progress (enrollment_id, lesson_id, completed_at) select :'e1', lesson_id, now() from learning_private.course_sequence(:'c30');
select tests.login(:cors_a);
set local role authenticated;
select tests.ok(learning.quiz_status(:'e1') ->> 'reason' = 'ore', 'test: bloccato senza le ore richieste');
reset role;
update learning.enrollments set active_seconds = 30 * 3600 where id = :'e1';
select tests.login(:cors_a);
set local role authenticated;
select learning.start_quiz(:'e1') as quiz \gset
select tests.ok(jsonb_array_length(:'quiz'::jsonb -> 'questions') = 2, 'test: estrae il numero di domande previsto');
select tests.ok(position('correct' in :'quiz') = 0, 'test: le soluzioni non arrivano al browser');
select tests.ok(learning.start_quiz(:'e1') ->> 'attempt_id' = :'quiz'::jsonb ->> 'attempt_id', 'test: ricaricando si riprende lo stesso tentativo');
select learning.submit_quiz((:'quiz'::jsonb ->> 'attempt_id')::uuid, jsonb_build_object(:q1, :'ok1', :q2, :'ok2')) as res \gset
select tests.ok((:'res'::jsonb ->> 'passed')::boolean and (:'res'::jsonb ->> 'score')::numeric = 100, 'test: tutto giusto, superato');
select tests.ok((select status = 'completato' from learning.enrollments where id = :'e1'), 'test superato: corso completato');
select tests.ok((select count(*) from learning.certificates where enrollment_id = :'e1') = 1, 'test superato: certificato emesso');
select tests.fails(format('select learning.submit_quiz(%L, ''{}'')', :'quiz'::jsonb ->> 'attempt_id'), 'test: non si consegna due volte');
rollback;

begin;
reset role;
insert into learning.lesson_progress (enrollment_id, lesson_id, completed_at) select :'e1', lesson_id, now() from learning_private.course_sequence(:'c30');
update learning.enrollments set active_seconds = 30 * 3600 where id = :'e1';
select tests.login(:cors_a);
set local role authenticated;
select learning.submit_quiz((learning.start_quiz(:'e1') ->> 'attempt_id')::uuid, jsonb_build_object(:q1, :'ko1')) as r1 \gset
select tests.ok(not (:'r1'::jsonb ->> 'passed')::boolean and not (:'r1'::jsonb ->> 'course_reset')::boolean, 'test: primo tentativo fallito, si riprova');
select learning.submit_quiz((learning.start_quiz(:'e1') ->> 'attempt_id')::uuid, '{}') as r2 \gset
select tests.ok((:'r2'::jsonb ->> 'course_reset')::boolean, 'test: tentativi esauriti, si rifà il corso');
select tests.ok((select active_seconds = 0 and cycle = 2 and status = 'assegnato' from learning.enrollments where id = :'e1'), 'rifare il corso: ore azzerate, nuovo ciclo');
select tests.ok(not exists (select 1 from learning.lesson_progress where enrollment_id = :'e1'), 'rifare il corso: lezioni da rifare');
select tests.ok((select count(*) from learning.quiz_attempts where enrollment_id = :'e1') = 2, 'rifare il corso: i tentativi restano registrati');
rollback;

begin;
reset role;
insert into learning.lesson_progress (enrollment_id, lesson_id, completed_at) select :'e1', lesson_id, now() from learning_private.course_sequence(:'c30');
update learning.enrollments set active_seconds = 30 * 3600 where id = :'e1';
select tests.login(:cors_a);
set local role authenticated;
select learning.start_quiz(:'e1') ->> 'attempt_id' as att \gset
reset role;
update learning.quiz_attempts set deadline_at = now() - interval '10 minutes' where id = :'att';
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((learning.submit_quiz(:'att', jsonb_build_object(:q1, :'ok1', :q2, :'ok2')) ->> 'score')::numeric = 0, 'test: consegna oltre il tempo non vale');
rollback;

begin;
reset role;
insert into learning.lesson_progress (enrollment_id, lesson_id, completed_at) select :'e1', lesson_id, now() from learning_private.course_sequence(:'c30');
update learning.enrollments set active_seconds = 30 * 3600 where id = :'e1';
insert into learning.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.fails(format('select learning.start_quiz(%L)', :'e1'), 'entra come: niente test sul corso vero');
reset role;
update learning.courses set is_demo = true where id = :'c30';
set local role authenticated;
select tests.ok((learning.submit_quiz((learning.start_quiz(:'e1') ->> 'attempt_id')::uuid, jsonb_build_object(:q1, :'ok1', :q2, :'ok2')) ->> 'passed')::boolean,
  'corso dimostrativo: test svolgibile in entra come');
select tests.ok((select is_demo from learning.certificates where enrollment_id = :'e1'), 'corso dimostrativo: certificato di prova');
rollback;

\warn 'TUTTI I TEST SUPERATI'
