-- Player: sblocco sequenziale e ore attive verificate lato server.
--
-- Il browser manda un heartbeat ogni ~30 s solo se la scheda è in primo piano e c'è
-- interazione recente. Il server accredita il tempo trascorso dall'heartbeat precedente
-- della stessa iscrizione, ma solo se è entro 40 s: dopo una pausa (idle, scheda nascosta,
-- chiusura) il primo heartbeat vale 0. Più schede aperte non raddoppiano il tempo.
-- Corsi dimostrativi (courses.is_demo): niente attese, niente ore accreditate, consentiti
-- anche durante "Entra come".

-- Lezioni approvate del corso nell'ordine di studio (modulo, poi lezione).
create function learning_private.course_sequence(cid uuid) returns table (lesson_id uuid, seq bigint)
language sql stable security definer set search_path = '' as $$
  select l.id, row_number() over (order by m.position, l.position)
  from learning.course_lessons cl
  join learning.lessons l on l.id = cl.lesson_id
  join learning.modules m on m.id = l.module_id
  where cl.course_id = cid and l.status = 'approvata'
$$;

-- Lezione sbloccata: fa parte del corso e tutte le precedenti sono completate.
create function learning_private.lesson_unlocked(eid uuid, cid uuid, lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with s as (select * from learning_private.course_sequence(cid))
  select exists (select 1 from s where s.lesson_id = lid)
     and not exists (
       select 1 from s
       where s.seq < (select seq from s where s.lesson_id = lid)
         and not exists (select 1 from learning.lesson_progress p
                         where p.enrollment_id = eid and p.lesson_id = s.lesson_id and p.completed_at is not null))
$$;

-- Iscrizione dell'utente effettivo, non scaduta, bloccata per l'aggiornamento.
-- Le azioni formali sono vietate durante "Entra come", salvo nei corsi dimostrativi.
create function learning_private.lock_my_enrollment(eid uuid, lid uuid, out e learning.enrollments, out demo boolean)
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
  if not demo then
    perform learning_private.assert_not_impersonating();
  end if;
  if not learning_private.lesson_unlocked(eid, e.course_id, lid) then
    raise exception 'Lezione non ancora disponibile: completa prima le precedenti' using errcode = 'P0001';
  end if;
end $$;

create function learning.heartbeat(p_enrollment uuid, p_lesson uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  last timestamptz;
  credit int := 0;
  lesson_total int;
begin
  select * into r from learning_private.lock_my_enrollment(p_enrollment, p_lesson);
  if not r.demo and (r.e).status <> 'completato' then
    select max(at) into last from learning.activity_heartbeats where enrollment_id = p_enrollment;
    if last is not null and now() - last <= interval '40 seconds' then
      credit := floor(extract(epoch from now() - last));
    end if;
    insert into learning.activity_heartbeats (enrollment_id, lesson_id, credited_seconds)
    values (p_enrollment, p_lesson, credit);
    update learning.enrollments
    set active_seconds = active_seconds + credit,
        status = case when status = 'assegnato' then 'in_corso' else status end
    where id = p_enrollment;
  end if;
  insert into learning.lesson_progress as p (enrollment_id, lesson_id, active_seconds)
  values (p_enrollment, p_lesson, credit)
  on conflict (enrollment_id, lesson_id) do update set active_seconds = p.active_seconds + credit
  returning active_seconds into lesson_total;
  return jsonb_build_object(
    'lesson_seconds', lesson_total,
    'total_seconds', (select active_seconds from learning.enrollments where id = p_enrollment));
end $$;

create function learning.complete_lesson(p_enrollment uuid, p_lesson uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from learning_private.lock_my_enrollment(p_enrollment, p_lesson);
  if not r.demo and coalesce((select active_seconds from learning.lesson_progress
                              where enrollment_id = p_enrollment and lesson_id = p_lesson), 0)
                    < (select min_seconds from learning.lessons where id = p_lesson) then
    raise exception 'Tempo minimo della lezione non ancora raggiunto' using errcode = 'P0001';
  end if;
  insert into learning.lesson_progress as p (enrollment_id, lesson_id, completed_at)
  values (p_enrollment, p_lesson, now())
  on conflict (enrollment_id, lesson_id) do update set completed_at = coalesce(p.completed_at, now());
  update learning.enrollments set status = 'in_corso' where id = p_enrollment and status = 'assegnato';
end $$;

grant execute on function learning_private.course_sequence(uuid), learning_private.lesson_unlocked(uuid, uuid, uuid),
  learning_private.lock_my_enrollment(uuid, uuid) to authenticated;
revoke execute on function learning.heartbeat(uuid, uuid), learning.complete_lesson(uuid, uuid) from public, anon;
grant execute on function learning.heartbeat(uuid, uuid), learning.complete_lesson(uuid, uuid) to authenticated;
