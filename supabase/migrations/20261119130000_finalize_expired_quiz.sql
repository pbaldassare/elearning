-- Restituisce il reset senza annullare la transazione con un errore.
create or replace function learning.start_quiz(p_enrollment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  a learning.quiz_attempts;
  st jsonb;
  expired_result jsonb;
begin
  select * into r from learning_private.lock_for_quiz(p_enrollment);
  -- Tentativo ancora aperto: si riprende (stesse domande, stesso tempo).
  select * into a from learning.quiz_attempts
  where enrollment_id = p_enrollment and cycle = (r.e).cycle and submitted_at is null and deadline_at > now();
  if found then
    return learning_private.quiz_payload(a);
  end if;
  -- Tentativi scaduti senza consegna: valgono come consegnati senza risposte.
  for a in select * from learning.quiz_attempts
           where enrollment_id = p_enrollment and cycle = (r.e).cycle
             and submitted_at is null and deadline_at <= now() order by started_at, id loop
    expired_result := learning_private.grade_attempt(a.id, '{}');
    update learning.quiz_attempts set submission_result = expired_result where id = a.id;
    if (expired_result ->> 'course_reset')::boolean then
      return jsonb_build_object('expired_result', expired_result);
    end if;
  end loop;

  st := learning.quiz_status(p_enrollment);
  if not (st ->> 'can_start')::boolean then
    if expired_result is not null then
      return jsonb_build_object('expired_result', expired_result);
    end if;
    raise exception '%', case st ->> 'reason'
      when 'superato' then 'Hai già superato il test'
      when 'scaduto' then 'Il corso è scaduto: contatta l''amministratore'
      when 'non_configurato' then 'Il test di questo corso non è ancora configurato'
      when 'lezioni' then 'Completa tutte le lezioni prima del test'
      when 'ore' then 'Non hai ancora raggiunto le ore richieste dal corso'
      when 'banco' then 'Il banco domande non è ancora pronto'
      else 'Test non disponibile' end using errcode = 'P0001';
  end if;

  insert into learning.quiz_attempts (enrollment_id, cycle, question_ids, deadline_at)
  values (p_enrollment, (r.e).cycle,
          array(select id from learning_private.quiz_pool((r.c).id) as id order by random() limit (r.c).quiz_questions_drawn),
          now() + make_interval(mins => (r.c).quiz_questions_drawn * (r.c).quiz_minutes_per_question))
  returning * into a;
  return learning_private.quiz_payload(a);
end $$;
