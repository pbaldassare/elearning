-- Contenuti Privacy approvati dall'utente; corsi Privacy attivi.
update learning.lessons set status = 'approvata', approved_at = coalesce(approved_at, now()) where status = 'bozza';
update learning.questions set status = 'approvata' where status = 'bozza';
update learning.courses set status = 'attivo' where title in ('Privacy', 'Privacy – dimostrazione');
