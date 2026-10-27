-- D-Academy: schema, ruoli, RLS, "Entra come".
--
-- Identità effettiva: ogni policy ragiona su effective_uid(), non su auth.uid().
-- Di norma coincidono; durante "Entra come" l'Admin manda l'header x-act-as e,
-- solo se esiste una sessione aperta da lui in impersonation_sessions (creata
-- dalla Edge Function "impersonate" dopo aver verificato il ruolo), il DB lo
-- tratta come l'utente impersonato. Header senza sessione = ignorato.

create schema private;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tipi

create type public.user_role as enum ('admin', 'azienda', 'corsista');
create type public.course_status as enum ('attivo', 'non_attivo', 'archiviato');
create type public.certificate_type as enum ('modello_ivass', 'generato_sistema');
create type public.content_status as enum ('bozza', 'approvata');
create type public.enrollment_status as enum ('assegnato', 'in_corso', 'completato');
create type public.change_kind as enum ('aggiunto', 'modificato', 'rimosso');
create type public.question_origin as enum ('excel', 'nuova');

-- Validazione formale del codice fiscale (formato, omocodia, carattere di controllo).
create function private.cf_valid(cf text) returns boolean
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

create table public.app_config (
  key text primary key,
  value jsonb not null,
  description text
);
comment on table public.app_config is 'Interruttori e parametri modificabili da Admin senza toccare il codice.';

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_number text unique,
  email text,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  company_id uuid references public.companies (id),
  first_name text not null,
  last_name text not null,
  codice_fiscale text unique check (codice_fiscale is null or private.cf_valid(codice_fiscale)),
  email text not null,
  is_demo boolean not null default false,
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  check (role = 'admin' or company_id is not null),
  check (role <> 'corsista' or codice_fiscale is not null)
);
create index on public.profiles (company_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- Libreria di lezioni condivisa tra più corsi (IVASS 30 e 60 ore usano la stessa).
create table public.lesson_libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  library_id uuid not null references public.lesson_libraries (id),
  title text not null,
  required_hours numeric(5, 1) not null check (required_hours > 0),
  status public.course_status not null default 'non_attivo',
  certificate_type public.certificate_type not null,
  certificate_template_path text,
  pass_threshold numeric(5, 2) not null default 70 check (pass_threshold between 0 and 100),
  expiry_days int not null default 30 check (expiry_days > 0),
  -- Parametri del test: da fornire, null = non ancora configurato (il test non parte).
  quiz_questions_drawn int check (quiz_questions_drawn > 0),
  quiz_max_attempts int check (quiz_max_attempts > 0),
  quiz_time_limit_minutes int check (quiz_time_limit_minutes > 0),
  created_at timestamptz not null default now()
);
create index on public.courses (category_id);
create index on public.courses (library_id);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.lesson_libraries (id) on delete cascade,
  position int not null,
  title text not null,
  unique (library_id, position)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules (id) on delete cascade,
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
  status public.content_status not null default 'bozza',
  approved_at timestamptz,
  unique (module_id, position)
);

create table public.content_changes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references public.lessons (id) on delete set null,
  kind public.change_kind not null,
  description text not null,
  source_ref text,
  created_at timestamptz not null default now()
);
comment on table public.content_changes is 'Cosa è stato aggiunto/modificato/rimosso rispetto al materiale originale, per la revisione.';

create table public.company_courses (
  company_id uuid not null references public.companies (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (company_id, course_id)
);
create index on public.company_courses (course_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id),
  company_id uuid not null references public.companies (id),
  assigned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.enrollment_status not null default 'assegnato',
  active_seconds int not null default 0,
  completed_at timestamptz,
  unique (user_id, course_id)
);
create index on public.enrollments (company_id);
create index on public.enrollments (course_id);

create table public.lesson_progress (
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id),
  active_seconds int not null default 0,
  completed_at timestamptz,
  primary key (enrollment_id, lesson_id)
);
create index on public.lesson_progress (lesson_id);

create table public.activity_heartbeats (
  id bigint generated always as identity primary key,
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id),
  at timestamptz not null default now(),
  credited_seconds int not null default 0
);
create index on public.activity_heartbeats (enrollment_id, at);
create index on public.activity_heartbeats (lesson_id);

create table public.access_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index on public.access_logs (user_id, at);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.lesson_libraries (id) on delete cascade,
  module_id uuid references public.modules (id) on delete set null,
  lesson_id uuid references public.lessons (id) on delete set null,
  text text not null,
  explanation text,
  source text,
  origin public.question_origin not null,
  status public.content_status not null default 'bozza',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.questions (library_id, status);
create index on public.questions (module_id);
create index on public.questions (lesson_id);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  position int not null,
  text text not null,
  is_correct boolean not null default false,
  unique (question_id, position)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  question_ids uuid[] not null,
  answers jsonb,
  score numeric(5, 2),
  passed boolean
);
create index on public.quiz_attempts (enrollment_id);

create sequence public.certificate_serial;

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  attempt_id uuid not null unique references public.quiz_attempts (id),
  serial bigint not null unique default nextval('public.certificate_serial'),
  verify_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  storage_path text,
  is_demo boolean not null default false,
  issued_at timestamptz not null default now()
);
create index on public.certificates (enrollment_id);

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  target_id uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on public.impersonation_sessions (admin_id) where ended_at is null;
create index on public.impersonation_sessions (target_id);

create table public.audit_impersonation (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id),
  target_id uuid not null references public.profiles (id),
  action text not null,
  details jsonb,
  at timestamptz not null default now()
);
create index on public.audit_impersonation (admin_id, at);
create index on public.audit_impersonation (target_id);
comment on table public.audit_impersonation is 'Registro tecnico interno: leggibile solo dagli Admin.';

-- ---------------------------------------------------------------- identità effettiva

create function private.header(name text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::json ->> name
$$;

create function private.is_real_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create function private.impersonated_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  target uuid;
begin
  begin
    target := private.header('x-act-as')::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if target is null or not private.is_real_admin() then
    return null;
  end if;
  return (
    select s.target_id from public.impersonation_sessions s
    where s.admin_id = auth.uid() and s.target_id = target and s.ended_at is null
    limit 1
  );
end $$;

create function private.is_impersonating() returns boolean
language sql stable set search_path = '' as $$
  select private.impersonated_id() is not null
$$;

create function private.effective_uid() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(private.impersonated_id(), auth.uid())
$$;

create function private.effective_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = private.effective_uid()
$$;

create function private.effective_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles where id = private.effective_uid()
$$;

create function private.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select private.effective_role() is not distinct from 'admin'
$$;

-- Per le azioni a valore formale (ore, completamento, test, certificato).
create function private.assert_not_impersonating() returns void
language plpgsql stable set search_path = '' as $$
begin
  if private.is_impersonating() then
    raise exception 'Azione non disponibile in questa modalità' using errcode = '42501';
  end if;
end $$;

create function private.can_see_enrollment(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = eid
      and (
        private.is_admin()
        or e.user_id = private.effective_uid()
        or (private.effective_role() = 'azienda' and e.company_id = private.effective_company())
      )
  )
$$;

grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------- trigger

-- Chi non è Admin non può cambiare ruolo, azienda, codice fiscale o flag demo.
create function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_admin() and current_user <> 'service_role' and (
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

create trigger guard_profile_update before update on public.profiles
for each row execute function private.guard_profile_update();

-- L'azienda dell'iscrizione è sempre quella del corsista; la scadenza la decide
-- il corso, salvo un Admin che la indichi esplicitamente.
create function private.prepare_enrollment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company_id := (select company_id from public.profiles where id = new.user_id);
  if tg_op = 'INSERT' and (new.expires_at is null or not private.is_admin()) then
    new.assigned_at := now();
    new.expires_at := now() + make_interval(days => (
      select expiry_days from public.courses where id = new.course_id
    ));
  end if;
  return new;
end $$;

create trigger prepare_enrollment before insert or update of user_id on public.enrollments
for each row execute function private.prepare_enrollment();

-- Ogni scrittura fatta durante "Entra come" finisce nel registro tecnico.
create function private.audit_impersonated_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := private.impersonated_id();
begin
  if target is not null then
    insert into public.audit_impersonation (admin_id, target_id, action, details)
    values (auth.uid(), target, lower(tg_op) || ' ' || tg_table_name,
            jsonb_build_object('row', to_jsonb(coalesce(new, old)) -> 'id'));
  end if;
  return coalesce(new, old);
end $$;

create trigger audit_impersonated_write after insert or update or delete on public.profiles
for each row execute function private.audit_impersonated_write();
create trigger audit_impersonated_write after insert or update or delete on public.enrollments
for each row execute function private.audit_impersonated_write();

-- ---------------------------------------------------------------- RLS

alter table public.app_config enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.lesson_libraries enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.content_changes enable row level security;
alter table public.company_courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.activity_heartbeats enable row level security;
alter table public.access_logs enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.certificates enable row level security;
alter table public.impersonation_sessions enable row level security;
alter table public.audit_impersonation enable row level security;

-- Tabelle gestite solo da Admin (le altre utenze non leggono nulla).
create policy admin_all on public.content_changes for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_all on public.questions for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_all on public.question_options for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Registro "Entra come": solo l'Admin reale, in sola lettura (scrive la Edge Function).
create policy admin_read on public.impersonation_sessions for select to authenticated
  using ((select private.is_real_admin()));
create policy admin_read on public.audit_impersonation for select to authenticated
  using ((select private.is_real_admin()));

create policy read on public.app_config for select to authenticated using (true);
create policy admin_write on public.app_config for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.companies for select to authenticated
  using ((select private.is_admin()) or id = (select private.effective_company()));
create policy admin_write on public.companies for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.profiles for select to authenticated
  using (
    (select private.is_admin())
    or id = (select private.effective_uid())
    or ((select private.effective_role()) = 'azienda' and company_id = (select private.effective_company()))
  );
create policy update_own_company on public.profiles for update to authenticated
  using (
    (select private.is_admin())
    or ((select private.effective_role()) = 'azienda' and company_id = (select private.effective_company()) and role = 'corsista')
  );

create policy read on public.categories for select to authenticated using (true);
create policy admin_write on public.categories for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.lesson_libraries for select to authenticated using (true);
create policy admin_write on public.lesson_libraries for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.courses for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.company_courses cc
               where cc.course_id = courses.id and cc.company_id = (select private.effective_company())
                 and (select private.effective_role()) = 'azienda')
    or exists (select 1 from public.enrollments e
               where e.course_id = courses.id and e.user_id = (select private.effective_uid()))
  );
create policy admin_write on public.courses for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Moduli e lezioni: visibili se appartengono alla libreria di un corso visibile.
create policy read on public.modules for select to authenticated
  using (exists (select 1 from public.courses c where c.library_id = modules.library_id));
create policy admin_write on public.modules for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.lessons for select to authenticated
  using (
    (select private.is_admin())
    or (status = 'approvata' and exists (select 1 from public.modules m where m.id = lessons.module_id))
  );
create policy admin_write on public.lessons for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.company_courses for select to authenticated
  using ((select private.is_admin()) or company_id = (select private.effective_company()));
create policy admin_write on public.company_courses for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy read on public.enrollments for select to authenticated
  using (
    (select private.is_admin())
    or user_id = (select private.effective_uid())
    or ((select private.effective_role()) = 'azienda' and company_id = (select private.effective_company()))
  );
-- L'Azienda assegna solo ai propri corsisti e solo corsi che le sono stati assegnati.
create policy insert on public.enrollments for insert to authenticated
  with check (
    (select private.is_admin())
    or (
      (select private.effective_role()) = 'azienda'
      and company_id = (select private.effective_company())
      and exists (select 1 from public.profiles p where p.id = enrollments.user_id and p.role = 'corsista')
      and exists (select 1 from public.company_courses cc
                  where cc.company_id = enrollments.company_id and cc.course_id = enrollments.course_id)
    )
  );
-- Proroga, riassegnazione e cancellazione: solo Admin.
create policy admin_update on public.enrollments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy admin_delete on public.enrollments for delete to authenticated
  using ((select private.is_admin()));

-- Tracciamento: lettura per chi vede l'iscrizione; scrittura solo tramite funzioni server.
create policy read on public.lesson_progress for select to authenticated
  using (private.can_see_enrollment(enrollment_id));
create policy read on public.activity_heartbeats for select to authenticated
  using (private.can_see_enrollment(enrollment_id));
create policy read on public.quiz_attempts for select to authenticated
  using (private.can_see_enrollment(enrollment_id));
create policy read on public.certificates for select to authenticated
  using (private.can_see_enrollment(enrollment_id));

-- Accessi: visibili a chi può vedere il profilo (RLS di profiles).
create policy read on public.access_logs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = access_logs.user_id));

-- ---------------------------------------------------------------- API

-- Scadenza calcolata: PostgREST la espone come colonna virtuale (select=*,is_expired).
create function public.is_expired(e public.enrollments) returns boolean
language sql stable set search_path = '' as $$
  select e.status <> 'completato' and e.expires_at < now()
$$;

-- Profilo effettivo + stato dell'impersonificazione + interruttori di login.
create function public.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'impersonating', private.is_impersonating(),
    'force_password_change',
      coalesce((select value = 'true'::jsonb from public.app_config where key = 'force_password_change'), false)
      and p.password_changed_at is null
      and not private.is_impersonating()
  )
  from public.profiles p
  where p.id = private.effective_uid()
$$;

create function public.log_access() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_impersonating() then
    return;
  end if;
  insert into public.access_logs (user_id, ip, user_agent)
  values (auth.uid(),
          trim(split_part(private.header('x-forwarded-for'), ',', 1)),
          private.header('user-agent'));
end $$;

create function public.mark_password_changed() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_not_impersonating();
  update public.profiles set password_changed_at = now() where id = auth.uid();
end $$;

revoke execute on function public.whoami(), public.log_access(), public.mark_password_changed() from public, anon;
grant execute on function public.whoami(), public.log_access(), public.mark_password_changed() to authenticated;
