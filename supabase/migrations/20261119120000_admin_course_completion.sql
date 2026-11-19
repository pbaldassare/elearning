-- Un attestato ha come origine un test in piattaforma o una convalida Admin.
alter table learning.certificates
  alter column attempt_id drop not null,
  add column confirmed_by uuid,
  add column confirmed_hours numeric(5, 1),
  add constraint certificate_has_one_source
    check (
      (attempt_id is not null and confirmed_by is null and confirmed_hours is null)
      or (attempt_id is null and confirmed_by is not null and confirmed_hours is not null and confirmed_hours > 0)
    );

create unique index certificates_one_admin_confirmation
on learning.certificates (enrollment_id) where confirmed_by is not null;

create function learning.confirm_course_completion(p_enrollment uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  enrollment learning.enrollments;
  course learning.courses;
  certificate_id uuid;
begin
  if not learning_private.is_admin() or learning_private.is_impersonating() then
    raise exception 'Operazione riservata agli amministratori' using errcode = '42501';
  end if;

  select * into enrollment from learning.enrollments where id = p_enrollment for update;
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = 'P0002';
  end if;

  select id into certificate_id from learning.certificates where enrollment_id = p_enrollment
  order by issued_at desc, id desc limit 1;
  if certificate_id is not null then return certificate_id; end if;

  select * into strict course from learning.courses where id = enrollment.course_id;
  if nullif(btrim(course.certificate_template_path), '') is null then
    raise exception 'Configura il modello di attestato prima di convalidare il corso' using errcode = 'P0001';
  end if;

  insert into learning.certificates (enrollment_id, confirmed_by, confirmed_hours, is_demo)
  select p_enrollment, auth.uid(), course.required_hours, course.is_demo or p.is_demo or co.is_demo
  from learning.profiles p join learning.companies co on co.id = enrollment.company_id
  where p.id = enrollment.user_id
  returning id into certificate_id;

  update learning.enrollments set status = 'completato', completed_at = coalesce(completed_at, now())
  where id = p_enrollment;
  return certificate_id;
end $$;

revoke execute on function learning.confirm_course_completion(uuid) from public, anon;
grant execute on function learning.confirm_course_completion(uuid) to authenticated;

create function learning.confirmed_hours(e learning.enrollments) returns numeric
language sql stable set search_path = '' as $$
  select c.confirmed_hours from learning.certificates c
  where c.enrollment_id = e.id and c.confirmed_by is not null
$$;

revoke execute on function learning.confirmed_hours(learning.enrollments) from public, anon;
grant execute on function learning.confirmed_hours(learning.enrollments) to authenticated;

-- Un tentativo aperto prima della convalida non può riaprire il corso o emettere un altro attestato.
create or replace function learning_private.lock_for_quiz(eid uuid, out e learning.enrollments, out c learning.courses)
language plpgsql security definer set search_path = '' as $$
begin
  select * into e from learning.enrollments where id = eid and user_id = learning_private.effective_uid() for update;
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = '42501';
  end if;
  if exists (select 1 from learning.certificates where enrollment_id = eid and confirmed_by is not null) then
    raise exception 'Corso già convalidato' using errcode = 'P0001';
  end if;
  select * into c from learning.courses where id = e.course_id;
end $$;

create or replace view learning.report_enrollments with (security_invoker = true) as
select
  e.id, e.company_id, e.course_id, e.user_id,
  p.last_name, p.first_name, p.codice_fiscale, p.email,
  co.name as company, c.title as course,
  e.status, learning.is_expired(e) as expired,
  e.assigned_at, e.expires_at, e.completed_at,
  e.active_seconds, c.required_hours,
  (select count(*) from learning.lesson_progress lp where lp.enrollment_id = e.id and lp.completed_at is not null) as lessons_done,
  (select count(*) from learning.course_lessons cl join learning.lessons l on l.id = cl.lesson_id
   where cl.course_id = c.id and l.status = 'approvata') as lessons_total,
  (select count(*) from learning.quiz_attempts a where a.enrollment_id = e.id and a.submitted_at is not null) as attempts,
  (select max(a.score) from learning.quiz_attempts a where a.enrollment_id = e.id) as best_score,
  (select ce.serial from learning.certificates ce where ce.enrollment_id = e.id order by ce.issued_at desc limit 1) as certificate_serial,
  (select max(al.at) from learning.access_logs al where al.user_id = e.user_id) as last_access,
  (p.is_demo or co.is_demo or c.is_demo) as is_demo,
  learning.confirmed_hours(e) as confirmed_hours
from learning.enrollments e
join learning.profiles p on p.id = e.user_id
join learning.companies co on co.id = e.company_id
join learning.courses c on c.id = e.course_id;
