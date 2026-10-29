-- IVASS: nuova "Area contrattuale e prodotti" (prima, come nel programma degli attestati).
-- Le lezioni si spostano senza cambiare id: progressi, iscrizioni e domande restano collegati.
do $$
declare
  lib uuid := (select id from learning.lesson_libraries where name = 'IVASS');
  m_new uuid;
begin
  update learning.modules set position = position + 10 where library_id = lib;
  update learning.modules set position = position - 9 where library_id = lib;
  insert into learning.modules (library_id, position, title) values (lib, 1, 'Area contrattuale e prodotti') returning id into m_new;

  -- (area di partenza dopo lo spostamento, posizioni, nuova base)
  update learning.lessons l set module_id = m_new, position = v.base + (l.position - v.lo + 1)
  from (values (3, 501, 509, 100), (2, 851, 854, 200), (3, 601, 608, 300), (4, 801, 803, 400), (5, 401, 403, 500), (3, 801, 805, 600))
       as v (mp, lo, hi, base),
       learning.modules m
  where m.library_id = lib and m.position = v.mp and l.module_id = m.id and l.position between v.lo and v.hi;

  update learning.lessons set topic = 'Condizioni contrattuali dei prodotti di investimento assicurativi'
  where module_id = m_new and position between 201 and 204;

  -- Domande: area e riferimento di importazione seguono la lezione.
  update learning.questions q set module_id = l.module_id,
    external_ref = 'tmp:lezione:' || m.position || '.' || l.position || ':' || split_part(q.external_ref, ':', 3)
  from learning.lessons l join learning.modules m on m.id = l.module_id
  where q.lesson_id = l.id and m.library_id = lib and q.external_ref like 'lezione:%';
  -- In due passi: i nuovi riferimenti possono coincidere con vecchi non ancora aggiornati.
  update learning.questions set external_ref = substr(external_ref, 5) where external_ref like 'tmp:lezione:%';
end $$;
