-- D-Academy: schema, ruoli, RLS, "Entra come".
--
-- Identità effettiva: ogni policy ragiona su effective_uid(), non su auth.uid().
-- Di norma coincidono; durante "Entra come" l'Admin manda l'header x-act-as e,
-- solo se esiste una sessione aperta da lui in impersonation_sessions (creata
-- dalla Edge Function "impersonate" dopo aver verificato il ruolo), il DB lo
-- tratta come l'utente impersonato. Header senza sessione = ignorato.

create schema learning;
create schema learning_private;
grant usage on schema learning, learning_private to anon, authenticated, service_role;
-- Come lo schema public di Supabase: le tabelle sono protette da RLS, i grant sono quelli standard.
alter default privileges in schema learning grant all on tables to anon, authenticated, service_role;
alter default privileges in schema learning grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema learning grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tipi

create type learning.user_role as enum ('admin', 'azienda', 'corsista');
create type learning.course_status as enum ('attivo', 'non_attivo', 'archiviato');
create type learning.certificate_type as enum ('modello_ivass', 'generato_sistema');
create type learning.content_status as enum ('bozza', 'approvata');
create type learning.enrollment_status as enum ('assegnato', 'in_corso', 'completato');
create type learning.change_kind as enum ('aggiunto', 'modificato', 'rimosso');
create type learning.question_origin as enum ('excel', 'nuova');

-- Validazione formale del codice fiscale (formato, omocodia, carattere di controllo).
create function learning_private.cf_valid(cf text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  odd int[] := array[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
  s int := 0;
  c text;
  v int;
begin
  if cf !~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$' then
    return false;
  end if;
  for i in 1..15 loop
    c := substr(cf, i, 1);
    v := case when c between '0' and '9' then ascii(c) - 48 else ascii(c) - 65 end;
    s := s + case when i % 2 = 1 then odd[v + 1] else v end;
  end loop;
  return substr(cf, 16, 1) = chr(65 + s % 26);
end $$;

-- ---------------------------------------------------------------- tabelle

create table learning.app_config (
  key text primary key,
  value jsonb not null,
  description text
);
comment on table learning.app_config is 'Interruttori e parametri modificabili da Admin senza toccare il codice.';

create table learning.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_number text unique,
  email text,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table learning.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role learning.user_role not null,
  company_id uuid references learning.companies (id),
  first_name text not null,
  last_name text not null,
  codice_fiscale text unique check (codice_fiscale is null or learning_private.cf_valid(codice_fiscale)),
  email text not null,
  is_demo boolean not null default false,
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  check (role = 'admin' or company_id is not null),
  check (role <> 'corsista' or codice_fiscale is not null)
);
create index on learning.profiles (company_id);

create table learning.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- Libreria di lezioni condivisa tra più corsi (IVASS 30 e 60 ore usano la stessa).
create table learning.lesson_libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table learning.courses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references learning.categories (id),
  library_id uuid not null references learning.lesson_libraries (id),
  title text not null,
  required_hours numeric(5, 1) not null check (required_hours > 0),
  status learning.course_status not null default 'non_attivo',
  certificate_type learning.certificate_type not null,
  certificate_template_path text,
  pass_threshold numeric(5, 2) not null default 70 check (pass_threshold between 0 and 100),
  expiry_days int not null default 30 check (expiry_days > 0),
  -- Parametri del test: da fornire, null = non ancora configurato (il test non parte).
  quiz_questions_drawn int check (quiz_questions_drawn > 0),
  quiz_max_attempts int check (quiz_max_attempts > 0),
  quiz_time_limit_minutes int check (quiz_time_limit_minutes > 0),
  created_at timestamptz not null default now()
);
create index on learning.courses (category_id);
create index on learning.courses (library_id);

create table learning.modules (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references learning.lesson_libraries (id) on delete cascade,
  position int not null,
  title text not null,
  unique (library_id, position)
);

create table learning.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references learning.modules (id) on delete cascade,
  position int not null,
  title text not null,
  slides jsonb not null default '[]',
  narration text,
  sources jsonb not null default '[]',
  min_seconds int not null default 0 check (min_seconds >= 0),
  -- Voce e video: fase successiva. Restano null finché non esistono i file.
  audio_path text,
  video_path text,
  captions_path text,
  status learning.content_status not null default 'bozza',
  approved_at timestamptz,
  unique (module_id, position)
);

create table learning.content_changes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references learning.lessons (id) on delete set null,
  kind learning.change_kind not null,
  description text not null,
  source_ref text,
  created_at timestamptz not null default now()
);
comment on table learning.content_changes is 'Cosa è stato aggiunto/modificato/rimosso rispetto al materiale originale, per la revisione.';

create table learning.company_courses (
  company_id uuid not null references learning.companies (id) on delete cascade,
  course_id uuid not null references learning.courses (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (company_id, course_id)
);
create index on learning.company_courses (course_id);

create table learning.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references learning.profiles (id) on delete cascade,
  course_id uuid not null references learning.courses (id),
  company_id uuid not null references learning.companies (id),
  assigned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status learning.enrollment_status not null default 'assegnato',
  active_seconds int not null default 0,
  completed_at timestamptz,
  unique (user_id, course_id)
);
create index on learning.enrollments (company_id);
create index on learning.enrollments (course_id);

create table learning.lesson_progress (
  enrollment_id uuid not null references learning.enrollments (id) on delete cascade,
  lesson_id uuid not null references learning.lessons (id),
  active_seconds int not null default 0,
  completed_at timestamptz,
  primary key (enrollment_id, lesson_id)
);
create index on learning.lesson_progress (lesson_id);

create table learning.activity_heartbeats (
  id bigint generated always as identity primary key,
  enrollment_id uuid not null references learning.enrollments (id) on delete cascade,
  lesson_id uuid not null references learning.lessons (id),
  at timestamptz not null default now(),
  credited_seconds int not null default 0
);
create index on learning.activity_heartbeats (enrollment_id, at);
create index on learning.activity_heartbeats (lesson_id);

create table learning.access_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references learning.profiles (id) on delete cascade,
  at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index on learning.access_logs (user_id, at);

create table learning.questions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references learning.lesson_libraries (id) on delete cascade,
  module_id uuid references learning.modules (id) on delete set null,
  lesson_id uuid references learning.lessons (id) on delete set null,
  text text not null,
  explanation text,
  source text,
  origin learning.question_origin not null,
  status learning.content_status not null default 'bozza',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on learning.questions (library_id, status);
create index on learning.questions (module_id);
create index on learning.questions (lesson_id);

create table learning.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references learning.questions (id) on delete cascade,
  position int not null,
  text text not null,
  is_correct boolean not null default false,
  unique (question_id, position)
);

create table learning.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references learning.enrollments (id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  question_ids uuid[] not null,
  answers jsonb,
  score numeric(5, 2),
  passed boolean
);
create index on learning.quiz_attempts (enrollment_id);

create sequence learning.certificate_serial;

create table learning.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references learning.enrollments (id) on delete cascade,
  attempt_id uuid not null unique references learning.quiz_attempts (id),
  serial bigint not null unique default nextval('learning.certificate_serial'),
  verify_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  storage_path text,
  is_demo boolean not null default false,
  issued_at timestamptz not null default now()
);
create index on learning.certificates (enrollment_id);

create table learning.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references learning.profiles (id),
  target_id uuid not null references learning.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on learning.impersonation_sessions (admin_id) where ended_at is null;
create index on learning.impersonation_sessions (target_id);

create table learning.audit_impersonation (
  id bigint generated always as identity primary key,
  admin_id uuid not null references learning.profiles (id),
  target_id uuid not null references learning.profiles (id),
  action text not null,
  details jsonb,
  at timestamptz not null default now()
);
create index on learning.audit_impersonation (admin_id, at);
create index on learning.audit_impersonation (target_id);
comment on table learning.audit_impersonation is 'Registro tecnico interno: leggibile solo dagli Admin.';

-- ---------------------------------------------------------------- identità effettiva

create function learning_private.header(name text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::json ->> name
$$;

create function learning_private.is_real_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from learning.profiles where id = auth.uid() and role = 'admin')
$$;

create function learning_private.impersonated_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  target uuid;
begin
  begin
    target := learning_private.header('x-act-as')::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if target is null or not learning_private.is_real_admin() then
    return null;
  end if;
  return (
    select s.target_id from learning.impersonation_sessions s
    where s.admin_id = auth.uid() and s.target_id = target and s.ended_at is null
    limit 1
  );
end $$;

create function learning_private.is_impersonating() returns boolean
language sql stable set search_path = '' as $$
  select learning_private.impersonated_id() is not null
$$;

create function learning_private.effective_uid() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(learning_private.impersonated_id(), auth.uid())
$$;

create function learning_private.effective_role() returns learning.user_role
language sql stable security definer set search_path = '' as $$
  select role from learning.profiles where id = learning_private.effective_uid()
$$;

create function learning_private.effective_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from learning.profiles where id = learning_private.effective_uid()
$$;

create function learning_private.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select learning_private.effective_role() is not distinct from 'admin'
$$;

-- Per le azioni a valore formale (ore, completamento, test, certificato).
create function learning_private.assert_not_impersonating() returns void
language plpgsql stable set search_path = '' as $$
begin
  if learning_private.is_impersonating() then
    raise exception 'Azione non disponibile in questa modalità' using errcode = '42501';
  end if;
end $$;

create function learning_private.can_see_enrollment(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from learning.enrollments e
    where e.id = eid
      and (
        learning_private.is_admin()
        or e.user_id = learning_private.effective_uid()
        or (learning_private.effective_role() = 'azienda' and e.company_id = learning_private.effective_company())
      )
  )
$$;

grant execute on all functions in schema learning_private to anon, authenticated, service_role;

-- ---------------------------------------------------------------- trigger

-- Chi non è Admin non può cambiare ruolo, azienda, codice fiscale o flag demo.
create function learning_private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not learning_private.is_admin() and current_user <> 'service_role' and (
    new.role is distinct from old.role
    or new.company_id is distinct from old.company_id
    or new.codice_fiscale is distinct from old.codice_fiscale
    or new.is_demo is distinct from old.is_demo
    or new.id is distinct from old.id
  ) then
    raise exception 'Solo un Admin può modificare questi campi' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_profile_update before update on learning.profiles
for each row execute function learning_private.guard_profile_update();

-- L'azienda dell'iscrizione è sempre quella del corsista; la scadenza la decide
-- il corso, salvo un Admin che la indichi esplicitamente.
create function learning_private.prepare_enrollment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company_id := (select company_id from learning.profiles where id = new.user_id);
  if tg_op = 'INSERT' and (new.expires_at is null or not learning_private.is_admin()) then
    new.assigned_at := now();
    new.expires_at := now() + make_interval(days => (
      select expiry_days from learning.courses where id = new.course_id
    ));
  end if;
  return new;
end $$;

create trigger prepare_enrollment before insert or update of user_id on learning.enrollments
for each row execute function learning_private.prepare_enrollment();

-- Ogni scrittura fatta durante "Entra come" finisce nel registro tecnico.
create function learning_private.audit_impersonated_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := learning_private.impersonated_id();
begin
  if target is not null then
    insert into learning.audit_impersonation (admin_id, target_id, action, details)
    values (auth.uid(), target, lower(tg_op) || ' ' || tg_table_name,
            jsonb_build_object('row', to_jsonb(coalesce(new, old)) -> 'id'));
  end if;
  return coalesce(new, old);
end $$;

create trigger audit_impersonated_write after insert or update or delete on learning.profiles
for each row execute function learning_private.audit_impersonated_write();
create trigger audit_impersonated_write after insert or update or delete on learning.enrollments
for each row execute function learning_private.audit_impersonated_write();

-- ---------------------------------------------------------------- RLS

alter table learning.app_config enable row level security;
alter table learning.companies enable row level security;
alter table learning.profiles enable row level security;
alter table learning.categories enable row level security;
alter table learning.lesson_libraries enable row level security;
alter table learning.courses enable row level security;
alter table learning.modules enable row level security;
alter table learning.lessons enable row level security;
alter table learning.content_changes enable row level security;
alter table learning.company_courses enable row level security;
alter table learning.enrollments enable row level security;
alter table learning.lesson_progress enable row level security;
alter table learning.activity_heartbeats enable row level security;
alter table learning.access_logs enable row level security;
alter table learning.questions enable row level security;
alter table learning.question_options enable row level security;
alter table learning.quiz_attempts enable row level security;
alter table learning.certificates enable row level security;
alter table learning.impersonation_sessions enable row level security;
alter table learning.audit_impersonation enable row level security;

-- Tabelle gestite solo da Admin (le altre utenze non leggono nulla).
create policy admin_all on learning.content_changes for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));
create policy admin_all on learning.questions for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));
create policy admin_all on learning.question_options for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

-- Registro "Entra come": solo l'Admin reale, in sola lettura (scrive la Edge Function).
create policy admin_read on learning.impersonation_sessions for select to authenticated
  using ((select learning_private.is_real_admin()));
create policy admin_read on learning.audit_impersonation for select to authenticated
  using ((select learning_private.is_real_admin()));

create policy read on learning.app_config for select to authenticated using (true);
create policy admin_write on learning.app_config for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.companies for select to authenticated
  using ((select learning_private.is_admin()) or id = (select learning_private.effective_company()));
create policy admin_write on learning.companies for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.profiles for select to authenticated
  using (
    (select learning_private.is_admin())
    or id = (select learning_private.effective_uid())
    or ((select learning_private.effective_role()) = 'azienda' and company_id = (select learning_private.effective_company()))
  );
create policy update_own_company on learning.profiles for update to authenticated
  using (
    (select learning_private.is_admin())
    or ((select learning_private.effective_role()) = 'azienda' and company_id = (select learning_private.effective_company()) and role = 'corsista')
  );

create policy read on learning.categories for select to authenticated using (true);
create policy admin_write on learning.categories for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.lesson_libraries for select to authenticated using (true);
create policy admin_write on learning.lesson_libraries for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.courses for select to authenticated
  using (
    (select learning_private.is_admin())
    or exists (select 1 from learning.company_courses cc
               where cc.course_id = courses.id and cc.company_id = (select learning_private.effective_company())
                 and (select learning_private.effective_role()) = 'azienda')
    or exists (select 1 from learning.enrollments e
               where e.course_id = courses.id and e.user_id = (select learning_private.effective_uid()))
  );
create policy admin_write on learning.courses for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

-- Moduli e lezioni: visibili se appartengono alla libreria di un corso visibile.
create policy read on learning.modules for select to authenticated
  using (exists (select 1 from learning.courses c where c.library_id = modules.library_id));
create policy admin_write on learning.modules for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.lessons for select to authenticated
  using (
    (select learning_private.is_admin())
    or (status = 'approvata' and exists (select 1 from learning.modules m where m.id = lessons.module_id))
  );
create policy admin_write on learning.lessons for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.company_courses for select to authenticated
  using ((select learning_private.is_admin()) or company_id = (select learning_private.effective_company()));
create policy admin_write on learning.company_courses for all to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));

create policy read on learning.enrollments for select to authenticated
  using (
    (select learning_private.is_admin())
    or user_id = (select learning_private.effective_uid())
    or ((select learning_private.effective_role()) = 'azienda' and company_id = (select learning_private.effective_company()))
  );
-- L'Azienda assegna solo ai propri corsisti e solo corsi che le sono stati assegnati.
create policy insert on learning.enrollments for insert to authenticated
  with check (
    (select learning_private.is_admin())
    or (
      (select learning_private.effective_role()) = 'azienda'
      and company_id = (select learning_private.effective_company())
      and exists (select 1 from learning.profiles p where p.id = enrollments.user_id and p.role = 'corsista')
      and exists (select 1 from learning.company_courses cc
                  where cc.company_id = enrollments.company_id and cc.course_id = enrollments.course_id)
    )
  );
-- Proroga, riassegnazione e cancellazione: solo Admin.
create policy admin_update on learning.enrollments for update to authenticated
  using ((select learning_private.is_admin())) with check ((select learning_private.is_admin()));
create policy admin_delete on learning.enrollments for delete to authenticated
  using ((select learning_private.is_admin()));

-- Tracciamento: lettura per chi vede l'iscrizione; scrittura solo tramite funzioni server.
create policy read on learning.lesson_progress for select to authenticated
  using (learning_private.can_see_enrollment(enrollment_id));
create policy read on learning.activity_heartbeats for select to authenticated
  using (learning_private.can_see_enrollment(enrollment_id));
create policy read on learning.quiz_attempts for select to authenticated
  using (learning_private.can_see_enrollment(enrollment_id));
create policy read on learning.certificates for select to authenticated
  using (learning_private.can_see_enrollment(enrollment_id));

-- Accessi: visibili a chi può vedere il profilo (RLS di profiles).
create policy read on learning.access_logs for select to authenticated
  using (exists (select 1 from learning.profiles p where p.id = access_logs.user_id));

-- ---------------------------------------------------------------- API

-- Scadenza calcolata: PostgREST la espone come colonna virtuale (select=*,is_expired).
create function learning.is_expired(e learning.enrollments) returns boolean
language sql stable set search_path = '' as $$
  select e.status <> 'completato' and e.expires_at < now()
$$;

-- Profilo effettivo + stato dell'impersonificazione + interruttori di login.
create function learning.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'impersonating', learning_private.is_impersonating(),
    'force_password_change',
      coalesce((select value = 'true'::jsonb from learning.app_config where key = 'force_password_change'), false)
      and p.password_changed_at is null
      and not learning_private.is_impersonating()
  )
  from learning.profiles p
  where p.id = learning_private.effective_uid()
$$;

create function learning.log_access() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or learning_private.is_impersonating() then
    return;
  end if;
  insert into learning.access_logs (user_id, ip, user_agent)
  values (auth.uid(),
          trim(split_part(learning_private.header('x-forwarded-for'), ',', 1)),
          learning_private.header('user-agent'));
end $$;

create function learning.mark_password_changed() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform learning_private.assert_not_impersonating();
  update learning.profiles set password_changed_at = now() where id = auth.uid();
end $$;

revoke execute on function learning.whoami(), learning.log_access(), learning.mark_password_changed() from public, anon;
grant execute on function learning.whoami(), learning.log_access(), learning.mark_password_changed() to authenticated;
