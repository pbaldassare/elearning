-- Un attestato ha come origine un test in piattaforma o una convalida Admin.
alter table learning.certificates
  alter column attempt_id drop not null,
  add column confirmed_by uuid,
  add constraint certificate_has_one_source
    check ((attempt_id is not null) <> (confirmed_by is not null));

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

  insert into learning.certificates (enrollment_id, confirmed_by, is_demo)
  select p_enrollment, auth.uid(), course.is_demo or p.is_demo or co.is_demo
  from learning.profiles p join learning.companies co on co.id = enrollment.company_id
  where p.id = enrollment.user_id
  returning id into certificate_id;

  update learning.enrollments set status = 'completato', completed_at = coalesce(completed_at, now())
  where id = p_enrollment;
  return certificate_id;
end $$;

revoke execute on function learning.confirm_course_completion(uuid) from public, anon;
grant execute on function learning.confirm_course_completion(uuid) to authenticated;

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
