-- Dati iniziali: configurazione, categorie, librerie e corsi. Rieseguibile.

insert into learning.app_config (key, value, description) values
  ('force_password_change', 'false', 'Obbliga il cambio password al primo accesso (attivare in produzione).'),
  ('idle_minutes', '5', 'Minuti senza interazione dopo cui il timer delle ore si ferma.'),
  ('expiry_warning_days', '5', 'Giorni prima della scadenza in cui inviare l''avviso email.')
on conflict (key) do nothing;

insert into learning.categories (name, slug) values
  ('Assicurativo (IVASS)', 'ivass'),
  ('Privacy', 'privacy')
on conflict (slug) do nothing;

insert into learning.lesson_libraries (name) values
  ('IVASS'),
  ('Privacy')
on conflict (name) do nothing;

-- IVASS 30 e 60 ore: stessa libreria, cambia solo la durata richiesta.
-- I parametri del test (quiz_*) restano null finché non vengono forniti.
insert into learning.courses (category_id, library_id, title, required_hours, status, certificate_type, is_demo)
select c.id, l.id, v.title, v.hours, v.status::learning.course_status, v.cert::learning.certificate_type, v.demo
from (values
  ('ivass', 'IVASS', 'IVASS 60 ore', 60, 'attivo', 'modello_ivass', false),
  ('ivass', 'IVASS', 'IVASS 30 ore', 30, 'attivo', 'modello_ivass', false),
  ('ivass', 'IVASS', 'IVASS 60 ore – dimostrazione', 60, 'attivo', 'modello_ivass', true),
  ('ivass', 'IVASS', 'IVASS 30 ore – dimostrazione', 30, 'attivo', 'modello_ivass', true),
  ('privacy', 'Privacy', 'Privacy', 1, 'non_attivo', 'generato_sistema', false)
) as v (cat, lib, title, hours, status, cert, demo)
join learning.categories c on c.slug = v.cat
join learning.lesson_libraries l on l.name = v.lib
where not exists (select 1 from learning.courses x where x.title = v.title);

-- Test IVASS: massimo 4 tentativi (poi si rifà il corso), 5 minuti per domanda.
-- Il numero di domande estratte resta da fornire.
update learning.courses set quiz_max_attempts = 4, quiz_minutes_per_question = 5
where certificate_type = 'modello_ivass' and quiz_max_attempts is null and quiz_minutes_per_question is null;
