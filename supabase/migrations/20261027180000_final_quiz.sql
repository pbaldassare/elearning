-- Test finale: estrazione casuale, tempo, correzione e tentativi tutto lato server.
--
-- Banco del corso = domande approvate della libreria, generali (senza lezione) o collegate a
-- lezioni del corso (così il 30 ore non pesca dagli approfondimenti del 60 ore).
-- Le risposte corrette (question_options.is_correct) restano visibili solo agli Admin: il
-- corsista riceve testo e opzioni da quiz_payload(), e dopo la consegna solo giusto/sbagliato.
-- Esauriti i tentativi senza superare il test si rifà il corso: ore e lezioni completate
-- ripartono da zero (nuovo "ciclo"), i tentativi precedenti restano registrati, la scadenza non cambia.

alter table learning.enrollments add column cycle int not null default 1;
alter table learning.quiz_attempts add column cycle int not null default 1;
alter table learning.questions add column external_ref text unique;
comment on column learning.questions.external_ref is 'Chiave di importazione (es. excel:2, lezione:<id>:<slide>) per reimportare senza doppioni.';

create function learning_private.quiz_pool(cid uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select q.id from learning.questions q
  join learning.courses c on c.library_id = q.library_id
  where c.id = cid and q.status = 'approvata'
    and (q.lesson_id is null or exists (
      select 1 from learning.course_lessons cl where cl.course_id = cid and cl.lesson_id = q.lesson_id))
    and (select count(*) from learning.question_options o where o.question_id = q.id and o.is_correct) = 1
$$;

-- Domande del tentativo, nell'ordine estratto, opzioni mescolate (stabili per tentativo), senza soluzioni.
create function learning_private.quiz_payload(a learning.quiz_attempts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attempt_id', a.id, 'deadline_at', a.deadline_at,
    'questions', (
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'text', q.text,
        'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by md5(o.id::text || a.id::text))
                    from learning.question_options o where o.question_id = q.id)) order by u.ord)
      from unnest(a.question_ids) with ordinality as u (qid, ord)
      join learning.questions q on q.id = u.qid))
$$;

-- Corregge e chiude un tentativo; gestisce superamento (certificato) o esaurimento dei tentativi.
create function learning_private.grade_attempt(aid uuid, answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a learning.quiz_attempts;
  e learning.enrollments;
  c learning.courses;
  total int;
  good int;
  pct numeric;
  ok boolean;
  used int;
  reset boolean := false;
begin
  select * into a from learning.quiz_attempts where id = aid for update;
  select * into e from learning.enrollments where id = a.enrollment_id for update;
  select * into c from learning.courses where id = e.course_id;
  total := cardinality(a.question_ids);
  select count(*) into good
  from unnest(a.question_ids) as qid
  join learning.question_options o on o.question_id = qid and o.is_correct and o.id::text = answers ->> qid::text;
  pct := round(good * 100.0 / total, 2);
  ok := pct >= c.pass_threshold;
  update learning.quiz_attempts set submitted_at = now(), answers = grade_attempt.answers, score = pct, passed = ok where id = aid;

  select count(*) into used from learning.quiz_attempts
  where enrollment_id = e.id and cycle = a.cycle and submitted_at is not null;

  if ok then
    update learning.enrollments set status = 'completato', completed_at = now() where id = e.id;
    insert into learning.certificates (enrollment_id, attempt_id, is_demo)
    values (e.id, aid, c.is_demo or (select p.is_demo from learning.profiles p where p.id = e.user_id));
  elsif used >= c.quiz_max_attempts then
    delete from learning.lesson_progress where enrollment_id = e.id;
    update learning.enrollments set active_seconds = 0, status = 'assegnato', cycle = cycle + 1 where id = e.id;
    reset := true;
  end if;

  return jsonb_build_object(
    'score', pct, 'passed', ok, 'correct', good, 'total', total, 'threshold', c.pass_threshold,
    'attempts_used', used, 'max_attempts', c.quiz_max_attempts, 'course_reset', reset,
    'results', (select jsonb_agg(jsonb_build_object('question_id', qid,
                  'correct', exists (select 1 from learning.question_options o
                                     where o.question_id = qid and o.is_correct and o.id::text = answers ->> qid::text)))
                from unnest(a.question_ids) as qid));
end $$;

-- Iscrizione dell'utente effettivo con il suo corso; azioni formali vietate in "Entra come" salvo corsi demo.
create function learning_private.lock_for_quiz(eid uuid, out e learning.enrollments, out c learning.courses)
language plpgsql security definer set search_path = '' as $$
begin
  select * into e from learning.enrollments where id = eid and user_id = learning_private.effective_uid() for update;
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = '42501';
  end if;
  select * into c from learning.courses where id = e.course_id;
  if not c.is_demo then
    perform learning_private.assert_not_impersonating();
  end if;
end $$;

-- Stato del test per la pagina del corsista.
create function learning.quiz_status(p_enrollment uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e learning.enrollments;
  c learning.courses;
  missing int;
  reason text;
begin
  select * into e from learning.enrollments where id = p_enrollment and user_id = learning_private.effective_uid();
  if not found then
    raise exception 'Iscrizione non trovata' using errcode = '42501';
  end if;
  select * into c from learning.courses where id = e.course_id;
  select count(*) into missing from learning_private.course_sequence(c.id) s
  where not exists (select 1 from learning.lesson_progress p
                    where p.enrollment_id = e.id and p.lesson_id = s.lesson_id and p.completed_at is not null);
  reason := case
    when e.status = 'completato' then 'superato'
    when learning.is_expired(e) then 'scaduto'
    when c.quiz_questions_drawn is null or c.quiz_max_attempts is null or c.quiz_minutes_per_question is null then 'non_configurato'
    when missing > 0 then 'lezioni'
    when not c.is_demo and e.active_seconds < c.required_hours * 3600 then 'ore'
    when (select count(*) from learning_private.quiz_pool(c.id)) < c.quiz_questions_drawn then 'banco'
    else null end;
  return jsonb_build_object(
    'can_start', reason is null, 'reason', reason, 'lessons_missing', missing,
    'questions', c.quiz_questions_drawn, 'minutes_per_question', c.quiz_minutes_per_question,
    'max_attempts', c.quiz_max_attempts, 'threshold', c.pass_threshold,
    'attempts_used', (select count(*) from learning.quiz_attempts
                      where enrollment_id = e.id and cycle = e.cycle and submitted_at is not null),
    'open_attempt', (select id from learning.quiz_attempts
                     where enrollment_id = e.id and cycle = e.cycle and submitted_at is null and deadline_at > now() limit 1));
end $$;

create function learning.start_quiz(p_enrollment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  a learning.quiz_attempts;
  st jsonb;
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
           where enrollment_id = p_enrollment and submitted_at is null and deadline_at <= now() loop
    perform learning_private.grade_attempt(a.id, '{}');
  end loop;

  st := learning.quiz_status(p_enrollment);
  if not (st ->> 'can_start')::boolean then
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

-- p_answers: { "<question_id>": "<option_id>", ... }. Oltre la scadenza (+2 min di tolleranza
-- per la rete) le risposte non contano.
create function learning.submit_quiz(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a learning.quiz_attempts;
begin
  select * into a from learning.quiz_attempts where id = p_attempt;
  if not found then
    raise exception 'Tentativo non trovato' using errcode = '42501';
  end if;
  perform learning_private.lock_for_quiz(a.enrollment_id);
  if a.submitted_at is not null then
    raise exception 'Test già consegnato' using errcode = 'P0001';
  end if;
  return learning_private.grade_attempt(p_attempt,
    case when now() <= a.deadline_at + interval '2 minutes' then coalesce(p_answers, '{}') else '{}' end);
end $$;

grant execute on function learning_private.quiz_pool(uuid), learning_private.quiz_payload(learning.quiz_attempts),
  learning_private.grade_attempt(uuid, jsonb), learning_private.lock_for_quiz(uuid) to authenticated;
revoke execute on function learning.quiz_status(uuid), learning.start_quiz(uuid), learning.submit_quiz(uuid, jsonb) from public, anon;
grant execute on function learning.quiz_status(uuid), learning.start_quiz(uuid), learning.submit_quiz(uuid, jsonb) to authenticated;
