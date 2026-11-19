-- Lo studio usa l'iscrizione del corsista effettivo anche durante «Entra come».
create or replace function learning_private.lock_my_enrollment(eid uuid, lid uuid, out e learning.enrollments, out demo boolean)
language plpgsql security definer set search_path = '' as $$
begin
  select * into e from learning.enrollments
  where id = eid and user_id = learning_private.effective_uid() for update;
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = '42501';
  end if;
  if learning.is_expired(e) then
    raise exception 'Il corso è scaduto: contatta l''amministratore' using errcode = 'P0001';
  end if;
  demo := (select c.is_demo from learning.courses c where c.id = e.course_id);
  if not learning_private.lesson_unlocked(eid, e.course_id, lid) then
    raise exception 'Lezione non ancora disponibile: completa prima le precedenti' using errcode = 'P0001';
  end if;
end $$;

create or replace function learning_private.lock_for_quiz(eid uuid, out e learning.enrollments, out c learning.courses)
language plpgsql security definer set search_path = '' as $$
begin
  select * into e from learning.enrollments
  where id = eid and user_id = learning_private.effective_uid() for update;
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = '42501';
  end if;
  select * into c from learning.courses where id = e.course_id;
end $$;

create trigger audit_impersonated_write after insert or update on learning.quiz_attempts
for each row execute function learning_private.audit_impersonated_write();

create trigger audit_impersonated_write after insert on learning.certificates
for each row execute function learning_private.audit_impersonated_write();
