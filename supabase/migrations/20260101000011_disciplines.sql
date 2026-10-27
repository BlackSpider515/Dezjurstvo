-- ============================================================
-- Дисциплины преподавателей и изоляция данных по дисциплинам
--
-- Выполнить после 20260101000010_grade_block_with_annotations.sql.
-- Миграция идемпотентна: её можно запускать повторно.
--
-- Что меняется:
--   * появляется список допущенных преподавателей teacher_allowlist;
--   * преподаватель создаёт дисциплину и привязывает её к группе;
--   * задания ссылаются на дисциплину, журнал и работы изолированы;
--   * RLS и Storage больше не дают преподавателю видеть чужие дисциплины;
--   * файлы оценённых работ удаляются сразу после подтверждения проверки
--     (7-дневная задержка больше не используется).
-- ============================================================

-- ---------- Список преподавателей, которым разрешена регистрация ----------
create table if not exists public.teacher_allowlist (
  full_name  text primary key check (char_length(btrim(full_name)) between 3 and 150),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.teacher_allowlist enable row level security;

-- Таблица доступна только Edge Function с service_role. Клиенты не должны
-- видеть даже список ФИО.
revoke all on public.teacher_allowlist from anon, authenticated;
grant all on public.teacher_allowlist to service_role;

insert into public.teacher_allowlist (full_name)
values
  ('Потапова Ксения Андреевна'),
  ('Пискунов Тимофей Александрович'),
  ('Ерошенко Екатерина Александровна')
on conflict (full_name) do nothing;

-- Если преподаватель Ksenia был создан раньше, приводим его к полному ФИО.
update public.profiles p
set full_name = 'Потапова Ксения Андреевна'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ksenia@diary.local'
  and p.role = 'admin';

-- Если преподаватель уже создан, отмечаем его в allowlist как занятого.
update public.teacher_allowlist ta
set claimed_by = p.id,
    claimed_at = coalesce(ta.claimed_at, now())
from public.profiles p
where p.role = 'admin'
  and lower(btrim(p.full_name)) = lower(ta.full_name)
  and ta.claimed_by is null;

-- ---------- Дисциплины ----------
create table if not exists public.disciplines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 150),
  group_name text not null references public.groups (name) on update cascade on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Одна и та же дисциплина не может дублироваться у группы: студент должен
-- однозначно понимать, куда сдавать работу. Владелец дисциплины — преподаватель.
drop index if exists public.disciplines_teacher_group_name_unique;
create unique index if not exists disciplines_group_name_unique
  on public.disciplines (group_name, lower(btrim(name)));

create index if not exists disciplines_group_idx
  on public.disciplines (group_name);

create index if not exists disciplines_teacher_idx
  on public.disciplines (teacher_id);

alter table public.disciplines enable row level security;

revoke all on public.disciplines from anon, authenticated;
grant select, insert, update, delete on public.disciplines to authenticated;

-- ---------- Привязка заданий к дисциплине ----------
alter table public.assignments
  add column if not exists discipline_id uuid references public.disciplines (id) on delete cascade;

create index if not exists assignments_discipline_idx
  on public.assignments (discipline_id, assigned_date, lesson_number);

-- Старые задания (до появления дисциплин) привязываем к первому
-- преподавателю. Если преподавателей нет, задания останутся без дисциплины
-- и не будут видны до ручной привязки.
do $$
declare
  v_teacher uuid;
begin
  select id into v_teacher
  from public.profiles
  where role = 'admin'
  order by created_at
  limit 1;

  if v_teacher is null then
    return;
  end if;

  insert into public.disciplines (name, group_name, teacher_id)
  select distinct on (a.group_name, lower(btrim(a.subject)))
    btrim(a.subject), a.group_name, v_teacher
  from public.assignments a
  where a.discipline_id is null
  order by a.group_name, lower(btrim(a.subject)), a.created_at
  on conflict do nothing;

  update public.assignments a
  set discipline_id = d.id
  from public.disciplines d
  where a.discipline_id is null
    and d.teacher_id = v_teacher
    and d.group_name = a.group_name
    and lower(btrim(d.name)) = lower(btrim(a.subject));
end $$;

-- Группа и название предмета задания всегда повторяют дисциплину.
create or replace function public.sync_assignment_discipline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_group text;
begin
  if new.discipline_id is null then
    return new;
  end if;

  select name, group_name into v_name, v_group
  from public.disciplines
  where id = new.discipline_id;

  if v_name is null then
    raise exception 'Дисциплина не найдена';
  end if;

  new.subject := v_name;
  new.group_name := v_group;
  return new;
end;
$$;

revoke all on function public.sync_assignment_discipline() from public;

drop trigger if exists assignments_sync_discipline on public.assignments;
create trigger assignments_sync_discipline
  before insert or update of discipline_id on public.assignments
  for each row execute function public.sync_assignment_discipline();

-- ---------- Helper-функции ----------
create or replace function public.teacher_owns_discipline(p_discipline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.disciplines
    where id = p_discipline_id
      and teacher_id = auth.uid()
  );
$$;

create or replace function public.student_can_access_discipline(p_discipline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.disciplines d
    join public.profiles p on p.id = auth.uid()
    where d.id = p_discipline_id
      and p.role = 'student'
      and p.group_name = d.group_name
  );
$$;

create or replace function public.teacher_owns_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    where a.id = p_assignment_id
      and public.teacher_owns_discipline(a.discipline_id)
  );
$$;

create or replace function public.teacher_owns_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = p_submission_id
      and public.teacher_owns_discipline(a.discipline_id)
  );
$$;

create or replace function public.teacher_owns_submission_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1
      from public.submissions s
      join public.assignments a on a.id = s.assignment_id
      where s.file_path = p_path
        and public.teacher_owns_discipline(a.discipline_id)
    )
    or exists (
      select 1
      from public.submission_versions v
      join public.submissions s on s.id = v.submission_id
      join public.assignments a on a.id = s.assignment_id
      where v.file_path = p_path
        and public.teacher_owns_discipline(a.discipline_id)
    );
$$;

revoke all on function public.teacher_owns_discipline(uuid) from public;
revoke all on function public.student_can_access_discipline(uuid) from public;
revoke all on function public.teacher_owns_assignment(uuid) from public;
revoke all on function public.teacher_owns_submission(uuid) from public;
revoke all on function public.teacher_owns_submission_path(text) from public;
grant execute on function public.teacher_owns_discipline(uuid) to authenticated;
grant execute on function public.student_can_access_discipline(uuid) to authenticated;
grant execute on function public.teacher_owns_assignment(uuid) to authenticated;
grant execute on function public.teacher_owns_submission(uuid) to authenticated;
grant execute on function public.teacher_owns_submission_path(text) to authenticated;

-- ---------- Политики: дисциплины ----------
drop policy if exists disciplines_select on public.disciplines;
create policy disciplines_select on public.disciplines
  for select to authenticated
  using (
    public.teacher_owns_discipline(id)
    or public.student_can_access_discipline(id)
  );

drop policy if exists disciplines_admin_write on public.disciplines;
create policy disciplines_admin_write on public.disciplines
  for all to authenticated
  using (public.is_admin() and teacher_id = auth.uid())
  with check (public.is_admin() and teacher_id = auth.uid());

-- ---------- Политики: задания ----------
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    public.teacher_owns_discipline(discipline_id)
    or public.student_can_access_discipline(discipline_id)
  );

drop policy if exists assignments_admin_all on public.assignments;
create policy assignments_admin_all on public.assignments
  for all to authenticated
  using (public.is_admin() and public.teacher_owns_discipline(discipline_id))
  with check (public.is_admin() and public.teacher_owns_discipline(discipline_id));

-- ---------- Политики: сдачи ----------
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (
    student_id = auth.uid()
    or public.teacher_owns_submission(id)
  );

drop policy if exists submissions_admin_all on public.submissions;

drop policy if exists submissions_admin_insert on public.submissions;
create policy submissions_admin_insert on public.submissions
  for insert to authenticated
  with check (
    public.is_admin()
    and public.teacher_owns_assignment(assignment_id)
  );

drop policy if exists submissions_admin_update on public.submissions;
create policy submissions_admin_update on public.submissions
  for update to authenticated
  using (
    public.is_admin()
    and public.teacher_owns_submission(id)
  )
  with check (
    public.is_admin()
    and public.teacher_owns_submission(id)
    and public.teacher_owns_assignment(assignment_id)
  );

drop policy if exists submissions_admin_delete on public.submissions;
create policy submissions_admin_delete on public.submissions
  for delete to authenticated
  using (
    public.is_admin()
    and public.teacher_owns_submission(id)
  );

-- ---------- Политики: версии файлов ----------
drop policy if exists versions_select on public.submission_versions;
create policy versions_select on public.submission_versions
  for select to authenticated
  using (
    public.teacher_owns_submission(submission_id)
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

drop policy if exists versions_insert on public.submission_versions;
create policy versions_insert on public.submission_versions
  for insert to authenticated
  with check (
    public.teacher_owns_submission(submission_id)
    or exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.student_id = auth.uid()
        and s.grade is null
        and s.file_path = file_path
        and s.version = version
        and file_path like auth.uid()::text || '/' || s.assignment_id::text || '/%'
    )
  );

drop policy if exists versions_admin_delete on public.submission_versions;
create policy versions_admin_delete on public.submission_versions
  for delete to authenticated
  using (public.is_admin() and public.teacher_owns_submission(submission_id));

drop policy if exists versions_admin_update on public.submission_versions;
create policy versions_admin_update on public.submission_versions
  for update to authenticated
  using (public.is_admin() and public.teacher_owns_submission(submission_id))
  with check (public.is_admin() and public.teacher_owns_submission(submission_id));

-- ---------- Политики: замечания ----------
drop policy if exists annotations_select on public.annotations;
create policy annotations_select on public.annotations
  for select to authenticated
  using (
    public.teacher_owns_submission(submission_id)
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

drop policy if exists annotations_admin_write on public.annotations;
create policy annotations_admin_write on public.annotations
  for all to authenticated
  using (public.is_admin() and public.teacher_owns_submission(submission_id))
  with check (public.is_admin() and public.teacher_owns_submission(submission_id));

-- ---------- Каталог дисциплин для выбора ----------
-- Отдаёт только дисциплины текущего преподавателя или группы студента.
-- View намеренно собирает имя преподавателя, потому что студент не имеет
-- прямого доступа к профилям преподавателей.
create or replace view public.discipline_catalog
with (security_barrier = true) as
select
  d.id,
  d.name,
  d.group_name,
  d.teacher_id,
  p.full_name as teacher_name,
  d.created_at
from public.disciplines d
join public.profiles p on p.id = d.teacher_id
where (
    public.is_admin()
    and d.teacher_id = auth.uid()
  )
  or exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role = 'student'
      and me.group_name = d.group_name
  );

revoke all on public.discipline_catalog from anon, authenticated;
grant select on public.discipline_catalog to authenticated;

-- ---------- Журнал ----------
create or replace view public.journal_entries
with (security_barrier = true) as
select
  s.id as submission_id,
  s.assignment_id,
  s.student_id,
  s.grade,
  s.status,
  s.submitted_at,
  s.updated_at
from public.submissions s
where s.student_id = auth.uid()
   or exists (
     select 1
     from public.assignments a
     where a.id = s.assignment_id
       and public.teacher_owns_discipline(a.discipline_id)
   )
   or s.student_id in (
     select p.id
     from public.profiles p
     where p.group_name = public.current_group()
       and p.role = 'student'
   );

revoke all on public.journal_entries from anon, authenticated;
grant select on public.journal_entries to authenticated;

-- ---------- Storage: преподаватель видит только файлы своих дисциплин ----------
drop policy if exists diary_submissions_select on storage.objects;
create policy diary_submissions_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.teacher_owns_submission_path(name)
    )
  );

drop policy if exists diary_submissions_admin_update on storage.objects;
create policy diary_submissions_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'submissions' and public.teacher_owns_submission_path(name))
  with check (bucket_id = 'submissions' and public.teacher_owns_submission_path(name));

drop policy if exists diary_submissions_admin_delete on storage.objects;
create policy diary_submissions_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'submissions' and public.teacher_owns_submission_path(name));

-- ---------- Индексы для удаления/проверки файлов ----------
create index if not exists submissions_file_path_idx
  on public.submissions (file_path)
  where file_path is not null;

create index if not exists submission_versions_file_path_idx
  on public.submission_versions (file_path)
  where file_path is not null;

-- ---------- Комментарии ----------
comment on table public.teacher_allowlist is
  'ФИО преподавателей, которым разрешена самостоятельная регистрация. Доступ только у service_role.';
comment on table public.disciplines is
  'Дисциплина преподавателя, привязанная к группе. Задания и работы изолированы по дисциплине.';
comment on view public.discipline_catalog is
  'Дисциплины, доступные текущему пользователю, с ФИО преподавателя.';
