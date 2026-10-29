-- Corso Privacy dimostrativo (come per IVASS): stesse lezioni, nessuna attesa, attestato di prova.
insert into learning.courses (category_id, library_id, title, required_hours, status, certificate_type, certificate_template_path,
  pass_threshold, expiry_days, quiz_questions_drawn, quiz_max_attempts, quiz_minutes_per_question, is_demo)
select category_id, library_id, 'Privacy – dimostrazione', required_hours, status, certificate_type, certificate_template_path,
  pass_threshold, expiry_days, quiz_questions_drawn, quiz_max_attempts, quiz_minutes_per_question, true
from learning.courses where title = 'Privacy';

insert into learning.course_lessons (course_id, lesson_id)
select d.id, cl.lesson_id from learning.course_lessons cl
join learning.courses p on p.id = cl.course_id and p.title = 'Privacy'
cross join learning.courses d where d.title = 'Privacy – dimostrazione';
