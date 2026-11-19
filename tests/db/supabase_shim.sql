-- Minimo indispensabile di Supabase per eseguire le migrazioni su un Postgres locale:
-- ruoli API, schema auth con auth.users e auth.uid(), grant di default come su Supabase.
-- Usato solo dai test, mai applicato al progetto reale.

-- I ruoli sono globali al cluster: creati solo la prima volta.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (bucket_id text references storage.buckets(id), name text not null);
alter table storage.objects enable row level security;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text
);

create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
