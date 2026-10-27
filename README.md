# D-Academy

Piattaforma e-learning multi-ruolo (Admin, Azienda, Corsista) per corsi di formazione professionale.
React + TypeScript + Tailwind, Supabase (Auth, Postgres con RLS, Storage, Edge Functions).

## Struttura

- `src/`: frontend (Vite).
- `supabase/migrations/`: schema del database versionato, con RLS su tutte le tabelle.
- `supabase/seed.sql`: configurazione, categorie e corsi iniziali (rieseguibile).
- `supabase/functions/`: Edge Functions (`impersonate` = "Entra come", `create-user` = creazione account con password standard).
- `tests/db/`: test di permessi per ruolo e impersonificazione su un Postgres locale.

Il materiale originale dei corsi **non** va nel repository (`materiale/` è in `.gitignore`).

## Variabili d'ambiente

Frontend (`.env`, vedi `.env.example`):

| Variabile | Descrizione |
|---|---|
| `VITE_SUPABASE_URL` | URL del progetto Supabase |
| `VITE_SUPABASE_ANON_KEY` | chiave pubblica (anon/publishable) |

Secrets delle Edge Functions (`supabase secrets set ...`): `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
sono forniti da Supabase. Va impostato `DEFAULT_PASSWORD` (password iniziale uguale per tutti i nuovi account):
senza, `create-user` risponde con errore.

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
supabase secrets set DEFAULT_PASSWORD=...
supabase functions deploy impersonate create-user
npm run build                        # poi pubblica dist/ (Vercel, Netlify, …)
```

Su Supabase imposta **Site URL** e **Redirect URLs** (Auth → URL Configuration) con il dominio di
produzione e `/reimposta-password`, usati dall'email di recupero password.

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

L'Admin apre una sessione con la Edge Function `impersonate`; il frontend manda poi l'header
`x-act-as`. Il database lo accetta solo se chi chiama è Admin **e** ha una sessione aperta, e
calcola tutti i permessi sull'utente impersonato. Avanzamento ore, completamento lezioni, test e
certificati sono rifiutati lato server durante l'impersonificazione. Ogni apertura, chiusura e
scrittura finisce in `audit_impersonation`, leggibile solo dagli Admin.
