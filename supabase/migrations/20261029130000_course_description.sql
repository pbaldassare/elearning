-- Introduzione del corso mostrata al corsista prima di iniziare (modificabile dall'Admin).
-- Regole (ore, test, scadenza) e argomenti non stanno qui: la pagina li legge dai dati del corso.
alter table learning.courses add column description text;

update learning.courses set description =
'Corso di aggiornamento professionale annuale obbligatorio per gli intermediari assicurativi, ai sensi del Regolamento IVASS n. 40/2018 e aggiornato alle ultime novità normative. Vale anche come formazione obbligatoria sulla normativa antiriciclaggio prevista dalla Legge 231/07.

Il programma tocca le aree previste dal Regolamento: contrattuale e prodotti, giuridica, tecnica assicurativa e riassicurativa, amministrativa e gestionale, informatica. Coordinatore scientifico e docente: Dr. Vincenzo Faraone.'
where title like 'IVASS 30 ore%';

update learning.courses set description =
'Corso di formazione obbligatorio per la prima iscrizione, ai sensi del Regolamento IVASS n. 40/2018 e aggiornato alle ultime novità normative. Vale anche come formazione obbligatoria sulla normativa antiriciclaggio prevista dalla Legge 231/07.

Oltre al programma comune con il corso di aggiornamento, contiene gli approfondimenti riservati al percorso da 60 ore nelle aree contrattuale e prodotti, giuridica, tecnica assicurativa e riassicurativa, amministrativa e gestionale, informatica. Coordinatore scientifico e docente: Dr. Vincenzo Faraone.'
where title like 'IVASS 60 ore%';

update learning.courses set description =
'Corso di formazione sulla protezione dei dati personali secondo il Regolamento UE 2016/679 (GDPR) e il d.lgs. 196/2003 come modificato dal d.lgs. 101/2018. È pensato per chi, in azienda, tratta dati di clienti, dipendenti e fornitori.

Si parte da cosa cambia con il GDPR, dalle definizioni e dai principi, si passa ai diritti degli interessati e agli adempimenti (titolare, responsabili, DPO, registro) e si chiude con sicurezza, data breach, valutazione d''impatto e sanzioni, con esempi pratici della vita d''ufficio. A cura di Paolo Baldassare.'
where title like 'Privacy%';
