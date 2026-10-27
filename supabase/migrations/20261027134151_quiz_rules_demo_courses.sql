-- Tempo del test per domanda (il totale dipende da quante domande si estraggono).
alter table public.courses rename column quiz_time_limit_minutes to quiz_minutes_per_question;
alter table public.courses rename constraint courses_quiz_time_limit_minutes_check to courses_quiz_minutes_per_question_check;

-- Corso dimostrativo: stesse lezioni, ma niente attesa di ore e tempi minimi, utilizzabile
-- anche con "Entra come" (per mostrarlo ai docenti); certificati solo di prova, escluso dai report.
alter table public.courses add column is_demo boolean not null default false;
comment on column public.courses.is_demo is
  'Corso dimostrativo: niente attesa di ore/tempi minimi, utilizzabile anche con "Entra come"; '
  'genera comunque il certificato con i dati dell''utente (impersonato), marcato di prova (certificates.is_demo).';
