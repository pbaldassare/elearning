-- Modifica sessione e registro nella stessa transazione, serializzata per admin.
create function learning.set_impersonation(p_admin uuid, p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from learning.profiles where id = p_admin and role = 'admin' for update;
  if not found then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
  if p_target is not null and not exists (
    select 1 from learning.profiles where id = p_target and role <> 'admin'
  ) then
    raise exception 'Utente non impersonabile' using errcode = '22023';
  end if;

  with closed as (
    update learning.impersonation_sessions set ended_at = now()
    where admin_id = p_admin and ended_at is null returning target_id
  )
  insert into learning.audit_impersonation (admin_id, target_id, action)
  select p_admin, target_id, 'stop' from closed;

  if p_target is not null then
    insert into learning.impersonation_sessions (admin_id, target_id) values (p_admin, p_target);
    insert into learning.audit_impersonation (admin_id, target_id, action)
    values (p_admin, p_target, 'start');
  end if;
end $$;

alter table learning.lesson_progress add column furthest_slide integer not null default 1;

create function learning.record_lesson_slide(p_enrollment uuid, p_lesson uuid, p_slide integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous_slide integer;
  slide_count integer;
begin
  perform learning_private.lock_my_enrollment(p_enrollment, p_lesson);
  select jsonb_array_length(slides) into slide_count from learning.lessons where id = p_lesson;
  select furthest_slide into previous_slide from learning.lesson_progress
  where enrollment_id = p_enrollment and lesson_id = p_lesson;
  if p_slide is null or p_slide < 1 or p_slide > slide_count or p_slide > coalesce(previous_slide, 1) + 1 then
    raise exception 'Apri le slide in ordine' using errcode = '22023';
  end if;
  insert into learning.lesson_progress as p (enrollment_id, lesson_id, furthest_slide)
  values (p_enrollment, p_lesson, p_slide)
  on conflict (enrollment_id, lesson_id) do update
  set furthest_slide = greatest(p.furthest_slide, excluded.furthest_slide);
end $$;

revoke execute on function learning.record_lesson_slide(uuid, uuid, integer) from public, anon;
grant execute on function learning.record_lesson_slide(uuid, uuid, integer) to authenticated;

create or replace function learning.complete_lesson(p_enrollment uuid, p_lesson uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  progress learning.lesson_progress;
  lesson learning.lessons;
begin
  select * into r from learning_private.lock_my_enrollment(p_enrollment, p_lesson);
  select * into lesson from learning.lessons where id = p_lesson;
  select * into progress from learning.lesson_progress
  where enrollment_id = p_enrollment and lesson_id = p_lesson;
  if progress.completed_at is not null then return; end if;
  if not r.demo and coalesce(progress.active_seconds, 0) < lesson.min_seconds then
    raise exception 'Tempo minimo della lezione non ancora raggiunto' using errcode = 'P0001';
  end if;
  if coalesce(progress.furthest_slide, 1) < jsonb_array_length(lesson.slides) then
    raise exception 'Arriva all’ultima slide prima di completare la lezione' using errcode = 'P0001';
  end if;
  insert into learning.lesson_progress as p (enrollment_id, lesson_id, completed_at)
  values (p_enrollment, p_lesson, now())
  on conflict (enrollment_id, lesson_id) do update set completed_at = coalesce(p.completed_at, now());
  update learning.enrollments set status = 'in_corso' where id = p_enrollment and status = 'assegnato';
end $$;

revoke execute on function learning.set_impersonation(uuid, uuid) from public, anon, authenticated;
grant execute on function learning.set_impersonation(uuid, uuid) to service_role;

-- Solo il cambio effettivo del segreto in Auth sblocca il profilo.
create function learning_private.record_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update learning.profiles set password_changed_at = now() where id = new.id;
  return new;
end $$;

create trigger learning_record_password_change after update of encrypted_password on auth.users
for each row when (old.encrypted_password is distinct from new.encrypted_password and new.encrypted_password <> '')
execute function learning_private.record_password_change();

create function learning_private.guard_password_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'Data del cambio password gestita da Auth' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger learning_guard_password_timestamp before update of password_changed_at on learning.profiles
for each row when (old.password_changed_at is distinct from new.password_changed_at)
execute function learning_private.guard_password_timestamp();

-- Mantiene compatibili le versioni del frontend già in cache.
create or replace function learning.mark_password_changed() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform learning_private.assert_not_impersonating();
end $$;

revoke execute on function learning.default_password() from public, anon, authenticated, service_role;

-- Un retry dopo una risposta persa restituisce l'esito già salvato.
alter table learning.quiz_attempts add column submission_result jsonb;

create or replace function learning.submit_quiz(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a learning.quiz_attempts;
  result jsonb;
begin
  select * into a from learning.quiz_attempts where id = p_attempt;
  if not found then
    raise exception 'Tentativo non trovato' using errcode = '42501';
  end if;
  perform learning_private.lock_for_quiz(a.enrollment_id);
  select * into strict a from learning.quiz_attempts where id = p_attempt for update;
  if a.submission_result is not null then
    return a.submission_result;
  end if;
  if a.submitted_at is not null then
    raise exception 'Test già consegnato' using errcode = 'P0001';
  end if;
  result := learning_private.grade_attempt(p_attempt,
    case when now() <= a.deadline_at + interval '2 minutes' then coalesce(p_answers, '{}') else '{}' end);
  update learning.quiz_attempts set submission_result = result where id = p_attempt;
  return result;
end $$;
