#!/usr/bin/env bash
# Applica shim Supabase, migrazioni e seed su un DB locale usa e getta, poi esegue i test.
# Richiede un Postgres raggiungibile con le variabili PG* standard.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-dacademy_test}"
dropdb --if-exists "$DB" && createdb "$DB"
run() { psql -qtA -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run tests/db/supabase_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
run supabase/seed.sql   # il seed deve essere rieseguibile
run tests/db/rls_test.sql
