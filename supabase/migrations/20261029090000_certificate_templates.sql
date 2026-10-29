-- Attestati: modelli PDF (originali senza dati personali, con firma) in un bucket privato.
-- Solo gli Admin caricano i modelli; il PDF compilato lo produce la Edge Function learning-certificate.
insert into storage.buckets (id, name, public) values ('learning-attestati', 'learning-attestati', false);

create policy learning_attestati_admin on storage.objects for all to authenticated
  using (bucket_id = 'learning-attestati' and (select learning_private.is_admin()))
  with check (bucket_id = 'learning-attestati' and (select learning_private.is_admin()));

update learning.courses set certificate_template_path = 'ivass-' || required_hours::int || '.pdf'
where certificate_type = 'modello_ivass' and required_hours in (30, 60);
