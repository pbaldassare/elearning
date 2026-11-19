# D-Academy

Piattaforma e-learning multi-ruolo (Admin, Azienda, Corsista) per corsi di formazione professionale.
React + TypeScript + Tailwind, Supabase (Auth, Postgres con RLS, Storage, Edge Functions).

## Struttura

- `src/`: frontend (Vite).
- `supabase/migrations/`: schema del database versionato, con RLS su tutte le tabelle.
- `supabase/seed.sql`: configurazione, categorie e corsi iniziali (rieseguibile).
- `supabase/functions/`: Edge Functions (`learning-impersonate` per "Entra come", `learning-create-user` per creare account con un link individuale di attivazione).
- `tests/db/`: test di permessi per ruolo e impersonificazione su un Postgres locale.

Il materiale originale dei corsi **non** va nel repository (`materiale/` è in `.gitignore`).

## Variabili d'ambiente

Frontend (`.env`, vedi `.env.example`):

| Variabile | Descrizione |
|---|---|
| `VITE_SUPABASE_URL` | URL del progetto Supabase |
| `VITE_SUPABASE_ANON_KEY` | chiave pubblica (anon/publishable) |

Secrets delle Edge Functions (`supabase secrets set ...`): `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
sono forniti da Supabase. Imposta `LEARNING_SITE_URL` all'origine pubblica di D-Academy per inviare il link di attivazione
tramite Supabase Auth. Configura SMTP e autorizza la destinazione `/reimposta-password` in Auth.
Se l'invio fallisce, l'utente può richiedere il link dalla pagina di recupero password.

## Sviluppo

```bash
npm install
cp .env.example .env   # e compila i valori
npm run dev
```

## Test del database

Richiede un Postgres 17 locale raggiungibile con le variabili `PG*` standard. Crea un DB usa e getta,
applica un mini-shim di Supabase (`tests/db/supabase_shim.sql`), migrazioni, seed (due volte, per
verificare che sia rieseguibile) e i test:

```bash
npm run test:db
```

## Deploy

```bash
supabase link --project-ref <ref>
supabase db push                     # migrazioni
psql "$DATABASE_URL" -f supabase/seed.sql
supabase config push                 # auth: niente registrazioni pubbliche
supabase secrets set LEARNING_SITE_URL=https://elearning-ba8.pages.dev
supabase functions deploy learning-impersonate learning-create-user learning-certificate
npm run build                        # poi pubblica dist/ (Vercel, Netlify, …)
```

Su Supabase imposta **Site URL** e **Redirect URLs** (Auth → URL Configuration) con il dominio di
produzione e `/reimposta-password`, usati dall'email di recupero password.

Per aggiornare un'installazione esistente, applica la migrazione e distribuisci le Edge Functions e il frontend nella stessa finestra.
Individua gli account che usano ancora la password iniziale precedente, revoca le loro sessioni e invia loro un link di recupero.
Dopo il rilascio puoi rimuovere il vecchio secret `DEFAULT_PASSWORD` o la voce corrispondente nel Vault.

## Configurazione senza toccare il codice

Tabella `app_config` (modificabile dall'Admin):

| Chiave | Default | Significato |
|---|---|---|
| `force_password_change` | `false` | obbliga il cambio password al primo accesso (attivare in produzione) |
| `idle_minutes` | `5` | minuti di inattività dopo cui il timer delle ore si ferma |
| `expiry_warning_days` | `5` | giorni prima della scadenza per l'avviso email |

Per corso: ore richieste, soglia di superamento (default 70%), giorni per completare (default 30),
parametri del test (`quiz_*`, vuoti finché non vengono forniti).

## "Entra come"

L'Admin apre una sessione con la Edge Function `learning-impersonate`; il frontend manda poi l'header
`x-act-as`. Il database lo accetta solo se chi chiama è Admin **e** ha una sessione aperta, e
calcola i permessi sull'utente impersonato. Ore, completamenti, test e attestati sono associati
all'iscrizione del corsista e rispettano le regole del corso. Le aperture, le chiusure, le modifiche
alle iscrizioni, i tentativi e l'emissione degli attestati sono registrati in `audit_impersonation`,
leggibile dagli Admin.

In **Corsisti**, l'Admin può convalidare un'iscrizione e generare l'attestato intestato al corsista.
La convalida registra chi l'ha autorizzata e lascia intatti ore, lezioni e tentativi del test.
Il corso deve avere un modello di attestato configurato.
