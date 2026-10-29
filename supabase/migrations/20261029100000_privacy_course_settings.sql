-- Corso Privacy: 5 ore come da modello di attestato; test come IVASS (10 domande, 4 tentativi, 5 minuti).
update learning.courses set required_hours = 5, certificate_template_path = 'privacy.pdf',
  quiz_questions_drawn = 10, quiz_max_attempts = 4, quiz_minutes_per_question = 5
where title = 'Privacy';
