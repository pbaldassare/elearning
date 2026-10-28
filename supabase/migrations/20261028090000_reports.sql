-- Report: una riga per iscrizione. security_invoker: la RLS delle tabelle decide cosa si vede
-- (Admin tutto, Azienda solo i propri corsisti, Corsista solo sé stesso).
-- is_demo marca account, aziende o corsi dimostrativi: la pagina li esclude dai report reali.
create view learning.report_enrollments with (security_invoker = true) as
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
  (p.is_demo or co.is_demo or c.is_demo) as is_demo
from learning.enrollments e
join learning.profiles p on p.id = e.user_id
join learning.companies co on co.id = e.company_id
join learning.courses c on c.id = e.course_id;

revoke all on learning.report_enrollments from anon, public;
grant select on learning.report_enrollments to authenticated;
