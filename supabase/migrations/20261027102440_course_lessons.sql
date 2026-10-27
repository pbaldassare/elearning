-- Argomento delle lezioni e lezioni incluse in ciascun corso.
-- IVASS 30 e 60 ore condividono la libreria: il nucleo comune è collegato a
-- entrambi, gli approfondimenti solo al 60 ore.

alter table public.lessons add column topic text;

create table public.course_lessons (
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  primary key (course_id, lesson_id)
);
create index on public.course_lessons (lesson_id);

alter table public.course_lessons enable row level security;

create policy read on public.course_lessons for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_lessons.course_id));
create policy admin_write on public.course_lessons for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
