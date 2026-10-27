-- Dati iniziali: configurazione, categorie, librerie e corsi. Rieseguibile.

insert into public.app_config (key, value, description) values
  ('force_password_change', 'false', 'Obbliga il cambio password al primo accesso (attivare in produzione).'),
  ('idle_minutes', '5', 'Minuti senza interazione dopo cui il timer delle ore si ferma.'),
  ('expiry_warning_days', '5', 'Giorni prima della scadenza in cui inviare l''avviso email.')
on conflict (key) do nothing;

insert into public.categories (name, slug) values
  ('Assicurativo (IVASS)', 'ivass'),
  ('Privacy', 'privacy')
on conflict (slug) do nothing;

insert into public.lesson_libraries (name) values
  ('IVASS'),
  ('Privacy')
on conflict (name) do nothing;

-- IVASS 30 e 60 ore: stessa libreria, cambia solo la durata richiesta.
-- I parametri del test (quiz_*) restano null finché non vengono forniti.
insert into public.courses (category_id, library_id, title, required_hours, status, certificate_type)
select c.id, l.id, v.title, v.hours, v.status::public.course_status, v.cert::public.certificate_type
from (values
  ('ivass', 'IVASS', 'IVASS 60 ore', 60, 'attivo', 'modello_ivass'),
  ('ivass', 'IVASS', 'IVASS 30 ore', 30, 'attivo', 'modello_ivass'),
  ('privacy', 'Privacy', 'Privacy', 1, 'non_attivo', 'generato_sistema')
) as v (cat, lib, title, hours, status, cert)
join public.categories c on c.slug = v.cat
join public.lesson_libraries l on l.name = v.lib
where not exists (select 1 from public.courses x where x.title = v.title);
