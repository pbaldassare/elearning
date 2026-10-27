-- Password standard dei nuovi account: dal secret DEFAULT_PASSWORD della Edge Function
-- oppure, se assente, da Supabase Vault (segreto cifrato "default_password").
-- Leggibile solo dal service role (cioè dalla Edge Function create-user).
create function public.default_password() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'default_password' limit 1);
end $$;

revoke execute on function public.default_password() from public, anon, authenticated;
grant execute on function public.default_password() to service_role;
