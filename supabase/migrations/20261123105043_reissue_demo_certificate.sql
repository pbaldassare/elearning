alter table learning.certificates
  add column replaces_demo_id uuid unique references learning.certificates(id);

drop index learning.certificates_one_admin_confirmation;
create unique index certificates_one_admin_confirmation
on learning.certificates (enrollment_id, is_demo) where confirmed_by is not null;

create or replace function learning.confirmed_hours(e learning.enrollments) returns numeric
language sql stable set search_path = '' as $$
  select c.confirmed_hours from learning.certificates c
  where c.enrollment_id = e.id and c.confirmed_by is not null
  order by c.is_demo, c.issued_at desc, c.id desc limit 1
$$;

create function learning.reissue_demo_certificate(p_enrollment uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  enrollment learning.enrollments;
  old_demo learning.certificates;
  new_id uuid;
  template text;
begin
  if not learning_private.is_admin() or learning_private.is_impersonating() then
    raise exception 'Operazione riservata agli amministratori' using errcode = '42501';
  end if;

  select * into enrollment from learning.enrollments where id = p_enrollment for update;
  if not found or enrollment.status <> 'completato' then
    raise exception 'Iscrizione completata non trovata' using errcode = 'P0002';
  end if;
  select id into new_id from learning.certificates
  where enrollment_id = p_enrollment and not is_demo order by issued_at desc, id desc limit 1;
  if new_id is not null then return new_id; end if;

  select * into old_demo from learning.certificates
  where enrollment_id = p_enrollment and is_demo and confirmed_by is not null;
  if not found then
    raise exception 'Attestato di prova da convalida non trovato' using errcode = 'P0002';
  end if;
  select c.certificate_template_path into template
  from learning.courses c, learning.companies co
  where c.id = enrollment.course_id and co.id = enrollment.company_id
    and not c.is_demo and not co.is_demo and co.archived_at is null
  for share of c, co;
  if not found then
    raise exception 'Occorrono un corso reale e un’azienda reale attiva' using errcode = 'P0001';
  end if;
  if template is null or template not in ('ivass-30.pdf', 'ivass-60.pdf', 'privacy.pdf')
    or not exists (select 1 from storage.objects where bucket_id = 'learning-attestati' and name = template) then
    raise exception 'Modello PDF non disponibile' using errcode = 'P0001';
  end if;

  update learning.profiles set is_demo = false where id = enrollment.user_id and is_demo;
  insert into learning.certificates (enrollment_id, confirmed_by, confirmed_hours, is_demo, replaces_demo_id)
  values (p_enrollment, auth.uid(), old_demo.confirmed_hours, false, old_demo.id)
  returning id into new_id;
  return new_id;
end $$;

revoke execute on function learning.reissue_demo_certificate(uuid) from public, anon;
grant execute on function learning.reissue_demo_certificate(uuid) to authenticated;
