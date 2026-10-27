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
insert into public.companies (id, name) values (:comp_a, 'Azienda A'), (:comp_b, 'Azienda B');
insert into public.profiles (id, role, company_id, first_name, last_name, codice_fiscale, email) values
  (:admin,  'admin',    null,    'Ada',   'Admin',   null,               'admin@test'),
  (:az_a,   'azienda',  :comp_a, 'Referente', 'A',   null,               'a@test'),
  (:az_b,   'azienda',  :comp_b, 'Referente', 'B',   null,               'b@test'),
  (:cors_a, 'corsista', :comp_a, 'Mario', 'Rossi',   'RSSMRA85T10A562S', 'ca@test'),
  (:cors_b, 'corsista', :comp_b, 'Laura', 'Bianchi', 'BNCLRA90A41H501F', 'cb@test');

select id as c30 from public.courses where title = 'IVASS 30 ore' \gset
select id as c60 from public.courses where title = 'IVASS 60 ore' \gset

insert into public.company_courses (company_id, course_id)
select :comp_a, id from public.courses where title = 'IVASS 30 ore';
insert into public.enrollments (user_id, course_id)
select :cors_a, id from public.courses where title = 'IVASS 30 ore';

insert into public.modules (library_id, position, title)
select id, 1, 'Area giuridica' from public.lesson_libraries where name = 'IVASS';
insert into public.lessons (module_id, position, title, status)
select id, 1, 'Lezione approvata', 'approvata' from public.modules where title = 'Area giuridica';
insert into public.lessons (module_id, position, title)
select id, 2, 'Lezione in bozza' from public.modules where title = 'Area giuridica';

-- ---------------------------------------------------------------- codice fiscale

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'x@test');

select tests.ok(private.cf_valid('RSSMRA85T10A562S'), 'CF valido accettato');
select tests.ok(private.cf_valid('RSSMRA85T10A56NH'), 'CF omocodico valido accettato');
select tests.ok(not private.cf_valid('RSSMRA85T10A562X'), 'CF con carattere di controllo errato rifiutato');
select tests.ok(not private.cf_valid('rssmra85t10a562s'), 'CF minuscolo rifiutato');
select tests.fails($$insert into public.profiles (id, role, company_id, first_name, last_name, codice_fiscale, email)
  values ('00000000-0000-0000-0000-0000000000ff', 'corsista', '00000000-0000-0000-0000-00000000c00a', 'X', 'Y', 'RSSMRA85T10A562S', 'x@test')$$,
  'CF duplicato rifiutato');
select tests.fails($$insert into public.profiles (id, role, company_id, first_name, last_name, email)
  values ('00000000-0000-0000-0000-0000000000ff', 'corsista', '00000000-0000-0000-0000-00000000c00a', 'X', 'Y', 'x@test')$$,
  'corsista senza CF rifiutato');

-- ---------------------------------------------------------------- anon

begin;
set local role anon;
select tests.ok((select count(*) from public.companies) = 0, 'anonimo: nessuna azienda');
select tests.ok((select count(*) from public.profiles) = 0, 'anonimo: nessun profilo');
select tests.ok((select count(*) from public.courses) = 0, 'anonimo: nessun corso');
rollback;

-- ---------------------------------------------------------------- admin

begin;
select tests.login(:admin);
set local role authenticated;
select tests.ok((select count(*) from public.companies) = 2, 'admin: vede tutte le aziende');
select tests.ok((select count(*) from public.profiles) = 5, 'admin: vede tutti i profili');
select tests.ok((select count(*) from public.courses) = 5, 'admin: vede tutti i corsi');
select tests.ok((select count(*) from public.lessons) = 2, 'admin: vede anche le bozze');
rollback;

-- ---------------------------------------------------------------- azienda

begin;
select tests.login(:az_a);
set local role authenticated;
select tests.ok((select array_agg(name) from public.companies) = array['Azienda A'], 'azienda A: vede solo sé stessa');
select tests.ok((select count(*) from public.profiles) = 2, 'azienda A: vede sé e i propri corsisti');
select tests.ok(not exists (select 1 from public.profiles where id = :cors_b), 'azienda A: non vede corsisti di B');
select tests.ok((select count(*) from public.enrollments) = 1, 'azienda A: vede le iscrizioni dei propri corsisti');
select tests.ok((select array_agg(title) from public.courses) = array['IVASS 30 ore'], 'azienda A: vede solo i corsi assegnati');
select tests.ok((select count(*) from public.audit_impersonation) = 0, 'azienda A: registro impersonificazione invisibile');
select tests.ok((select count(*) from public.questions) = 0, 'azienda A: banco domande invisibile');
select tests.fails(format('insert into public.enrollments (user_id, course_id) values (%L, %L)', :cors_a, :'c60'),
  'azienda A: non assegna corsi che non le sono stati assegnati');
select tests.fails(format('insert into public.enrollments (user_id, course_id) values (%L, %L)', :cors_b, :'c30'),
  'azienda A: non assegna corsi a corsisti di B');
select tests.fails($$update public.profiles set company_id = '00000000-0000-0000-0000-00000000c00b'
  where id = '00000000-0000-0000-0000-0000000000a2'$$, 'azienda A: non sposta corsisti di azienda');
select tests.fails($$update public.profiles set codice_fiscale = 'VRDGPP80B01F205W'
  where id = '00000000-0000-0000-0000-0000000000a2'$$, 'azienda A: non cambia il codice fiscale');
update public.profiles set first_name = 'Marco' where id = :cors_a;
select tests.ok((select first_name from public.profiles where id = :cors_a) = 'Marco', 'azienda A: modifica il nome del proprio corsista');
with u as (update public.profiles set first_name = 'Hack' where id = :cors_b returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non modifica corsisti di B');
with u as (update public.enrollments set expires_at = now() + interval '1 year' returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non proroga le scadenze');
rollback;

-- Azienda assegna un corso che le è stato assegnato: la scadenza la decide il corso.
begin;
insert into public.company_courses (company_id, course_id)
select :comp_a, id from public.courses where title = 'IVASS 60 ore';
select tests.login(:az_a);
set local role authenticated;
insert into public.enrollments (user_id, course_id, expires_at)
select :cors_a, id, now() + interval '10 years' from public.courses where title = 'IVASS 60 ore';
select tests.ok(
  (select expires_at::date = (now() + interval '30 days')::date from public.enrollments e
   join public.courses c on c.id = e.course_id where c.title = 'IVASS 60 ore'),
  'azienda A: assegna al proprio corsista, scadenza forzata a 30 giorni');
rollback;

begin;
select tests.login(:az_b);
set local role authenticated;
select tests.ok((select count(*) from public.enrollments) = 0, 'azienda B: non vede iscrizioni di A');
select tests.ok((select count(*) from public.courses) = 0, 'azienda B: nessun corso assegnato');
rollback;

-- ---------------------------------------------------------------- corsista

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 1, 'corsista: vede solo il proprio profilo');
select tests.ok((select count(*) from public.companies) = 1, 'corsista: vede la propria azienda');
select tests.ok((select array_agg(title) from public.courses) = array['IVASS 30 ore'], 'corsista: vede solo i corsi assegnati');
select tests.ok((select array_agg(title) from public.lessons) = array['Lezione approvata'], 'corsista: non vede le lezioni in bozza');
select tests.ok((select count(*) from public.question_options) = 0, 'corsista: non vede le risposte del banco');
select tests.ok((select count(*) from public.app_config) > 0, 'corsista: legge la configurazione');
select tests.fails($$insert into public.lesson_progress (enrollment_id, lesson_id)
  select e.id, l.id from public.enrollments e, public.lessons l limit 1$$, 'corsista: non scrive i progressi direttamente');
with u as (update public.app_config set value = 'true' where key = 'force_password_change' returning 1)
select tests.ok((select count(*) from u) = 0, 'corsista: non modifica la configurazione');
select tests.ok(not (select public.is_expired(e) from public.enrollments e), 'corsista: corso non scaduto');
select public.log_access();
select tests.ok((select ip = '203.0.113.7' and user_agent = 'test-agent' from public.access_logs), 'corsista: accesso registrato con IP e dispositivo');
select tests.ok((public.whoami() -> 'profile' ->> 'id')::uuid = :cors_a, 'whoami: profilo del corsista');
select tests.ok(not (public.whoami() ->> 'force_password_change')::boolean, 'cambio password non imposto di default');
rollback;

begin;
update public.app_config set value = 'true' where key = 'force_password_change';
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((public.whoami() ->> 'force_password_change')::boolean, 'interruttore attivo: cambio password richiesto');
select public.mark_password_changed();
select tests.ok(not (public.whoami() ->> 'force_password_change')::boolean, 'dopo il cambio non è più richiesto');
rollback;

begin;
update public.enrollments set expires_at = now() - interval '1 day';
select tests.ok((select public.is_expired(e) from public.enrollments e), 'iscrizione oltre la scadenza risulta scaduta');
rollback;

-- ---------------------------------------------------------------- "Entra come"

begin;
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 5, 'header senza sessione aperta: ignorato');
rollback;

begin;
insert into public.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select array_agg(id) from public.profiles) = array[:cors_a::uuid], 'admin come corsista: vede solo ciò che vede il corsista');
select tests.ok((select array_agg(title) from public.lessons) = array['Lezione approvata'], 'admin come corsista: niente bozze');
select tests.ok((public.whoami() ->> 'impersonating')::boolean, 'whoami: segnala l''impersonificazione all''admin');
select tests.ok((public.whoami() -> 'profile' ->> 'role') = 'corsista', 'whoami: ruolo effettivo corsista');
select tests.fails('select private.assert_not_impersonating()', 'admin come corsista: azioni formali bloccate');
select tests.fails('select public.mark_password_changed()', 'admin come corsista: non tocca la password');
select public.log_access();
select tests.ok((select count(*) from public.access_logs) = 0, 'admin come corsista: nessun accesso registrato a nome del corsista');
select tests.ok((select count(*) from public.audit_impersonation) = 0, 'registro leggibile dall''admin reale (vuoto)');
rollback;

begin;
insert into public.impersonation_sessions (admin_id, target_id) values (:admin, :az_a);
insert into public.company_courses (company_id, course_id)
select :comp_a, id from public.courses where title = 'IVASS 60 ore';
select tests.login(:admin, :az_a);
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 2, 'admin come azienda A: vede i dati di A');
insert into public.enrollments (user_id, course_id)
select :cors_a, id from public.courses where title = 'IVASS 60 ore';
select tests.ok((select count(*) from public.audit_impersonation where action = 'insert enrollments') = 1,
  'admin come azienda A: assegnazione registrata nel registro tecnico');
reset role;
select tests.ok((select admin_id = :admin::uuid and target_id = :az_a::uuid from public.audit_impersonation),
  'registro: admin reale e utente impersonato');
rollback;

begin;
insert into public.impersonation_sessions (admin_id, target_id) values (:admin, :cors_a);
update public.impersonation_sessions set ended_at = now();
select tests.login(:admin, :cors_a);
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 5, 'sessione chiusa: torna admin');
rollback;

begin;
insert into public.impersonation_sessions (admin_id, target_id) values (:az_a, :cors_b);
select tests.login(:az_a, :cors_b);
set local role authenticated;
select tests.ok(not exists (select 1 from public.profiles where id = :cors_b), 'non admin con sessione e header: ignorato');
rollback;

begin;
select tests.login(:cors_a, :admin);
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 1, 'corsista con header verso admin: ignorato');
select tests.ok((select count(*) from public.audit_impersonation) = 0, 'corsista: registro invisibile');
rollback;

-- ---------------------------------------------------------------- lezioni per corso

insert into public.course_lessons (course_id, lesson_id)
select c.id, l.id from public.courses c, public.lessons l where c.title in ('IVASS 30 ore', 'IVASS 60 ore');

begin;
select tests.login(:cors_a);
set local role authenticated;
select tests.ok((select count(distinct course_id) from public.course_lessons) = 1, 'corsista: vede le lezioni solo del proprio corso');
rollback;

begin;
select tests.login(:az_b);
set local role authenticated;
select tests.ok((select count(*) from public.course_lessons) = 0, 'azienda B: nessuna lezione di corsi non assegnati');
with u as (insert into public.course_lessons select course_id, lesson_id from public.course_lessons returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda B: non modifica le lezioni dei corsi');
rollback;

-- ---------------------------------------------------------------- assegnazioni e spostamenti

begin;
select tests.login(:az_a);
set local role authenticated;
select tests.fails(format('insert into public.enrollments (user_id, course_id) values (%L, %L)', :cors_b, :'c30'),
  'azienda A: non iscrive corsisti di B');
select tests.fails(format('insert into public.enrollments (user_id, course_id) values (%L, %L)', :cors_a, :'c60'),
  'azienda A: non assegna corsi non suoi');
with u as (update public.enrollments set expires_at = now() + interval '1 year' where user_id = :cors_a returning 1)
select tests.ok((select count(*) from u) = 0, 'azienda A: non proroga');
rollback;

begin;
select tests.login(:admin);
set local role authenticated;
update public.profiles set company_id = :comp_b where id = :cors_a;
select tests.ok((select company_id = :comp_b::uuid from public.enrollments where user_id = :cors_a),
  'spostamento: le iscrizioni seguono il corsista');
select tests.login(:az_a);
select tests.ok(not exists (select 1 from public.enrollments where user_id = :cors_a), 'spostamento: la vecchia azienda non vede più');
rollback;

\warn 'TUTTI I TEST SUPERATI'
