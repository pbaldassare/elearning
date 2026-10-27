-- Spostare un corsista tra aziende sposta anche le sue iscrizioni: la nuova
-- azienda ne vede i progressi, la vecchia non più.
create function private.move_enrollments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.enrollments set company_id = new.company_id where user_id = new.id;
  return new;
end $$;

create trigger move_enrollments after update of company_id on public.profiles
for each row when (new.company_id is distinct from old.company_id)
execute function private.move_enrollments();
