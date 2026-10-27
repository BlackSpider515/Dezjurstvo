-- ============================================================
-- RLS, права и helper-функции
-- ============================================================

-- ---------- Helper-функции ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_group()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select group_name
  from public.profiles
  where id = auth.uid() and role = 'student';
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.current_group() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.current_group() to authenticated;

-- ---------- Включаем RLS ----------
alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_versions enable row level security;
alter table public.annotations enable row level security;

-- ---------- Права на таблицы ----------
-- profiles: студент не должен иметь возможности прочитать чужой login,
-- поэтому на колонку login прав нет ни у кого, кроме service_role.
revoke all on public.profiles from anon, authenticated;
grant select (id, role, full_name, group_name, created_at) on public.profiles to authenticated;
-- нужно для ON UPDATE CASCADE при переименовании группы (RLS разрешит только админу)
grant update (group_name) on public.profiles to authenticated;

revoke all on public.groups from anon, authenticated;
grant select on public.groups to anon, authenticated;
grant insert, update, delete on public.groups to authenticated;

revoke all on public.assignments from anon, authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

revoke all on public.submissions from anon, authenticated;
grant select, insert, update, delete on public.submissions to authenticated;

revoke all on public.submission_versions from anon, authenticated;
grant select, insert, update, delete on public.submission_versions to authenticated;

revoke all on public.annotations from anon, authenticated;
grant select, insert, update, delete on public.annotations to authenticated;

-- ---------- Политики: groups ----------
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select to anon, authenticated
  using (true);

drop policy if exists groups_admin_write on public.groups;
create policy groups_admin_write on public.groups
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Политики: profiles ----------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_group on public.profiles;
create policy profiles_select_group on public.profiles
  for select to authenticated
  using (role = 'student' and group_name = public.current_group());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Политики: assignments ----------
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (public.is_admin() or group_name = public.current_group());

drop policy if exists assignments_admin_all on public.assignments;
create policy assignments_admin_all on public.assignments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Политики: submissions ----------
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (public.is_admin() or student_id = auth.uid());

-- Студент создаёт сдачу только вместе с реальным файлом в своей папке:
-- путь должен быть {student_id}/{assignment_id}/{file}. Отметку «+» без файла
-- ставит преподаватель через admin-политику.
drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own on public.submissions
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and grade is null
    and status = 'submitted'
    and version = 1
    and file_path is not null
    and original_name is not null
    and size is not null
    and file_path like auth.uid()::text || '/' || assignment_id::text || '/%'
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_id and a.group_name = public.current_group()
    )
  );

drop policy if exists submissions_update_own on public.submissions;
create policy submissions_update_own on public.submissions
  for update to authenticated
  using (student_id = auth.uid() and grade is null)
  with check (
    student_id = auth.uid()
    and grade is null
    and status = 'submitted'
    and file_path is not null
    and original_name is not null
    and size is not null
    and file_path like auth.uid()::text || '/' || assignment_id::text || '/%'
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_id and a.group_name = public.current_group()
    )
  );

-- Даже если политика когда-нибудь ослабнет, студент не сможет подменить
-- студента/задание, выставить себе оценку или сменить статус.
create or replace function public.guard_submission_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if old.grade is not null then
    raise exception 'Оценённая работа заблокирована';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'Нельзя изменить студента у сдачи';
  end if;
  if new.assignment_id is distinct from old.assignment_id then
    raise exception 'Нельзя изменить задание у сдачи';
  end if;
  if new.grade is distinct from old.grade then
    raise exception 'Оценку выставляет только преподаватель';
  end if;
  if new.status <> 'submitted' then
    raise exception 'Нельзя изменить статус сдачи';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Номер версии должен увеличиваться на единицу';
  end if;
  if new.file_path is null
     or new.file_path not like old.student_id::text || '/' || old.assignment_id::text || '/%' then
    raise exception 'Некорректный путь файла';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_submission_update() from public;

drop trigger if exists submissions_guard_student_update on public.submissions;
create trigger submissions_guard_student_update
  before update on public.submissions
  for each row execute function public.guard_submission_update();

drop policy if exists submissions_admin_all on public.submissions;
create policy submissions_admin_all on public.submissions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Политики: submission_versions ----------
drop policy if exists versions_select on public.submission_versions;
create policy versions_select on public.submission_versions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

-- Студент добавляет версию только к собственной неоценённой сдаче, и путь
-- версии должен совпадать с текущим файлом этой сдачи в его папке.
drop policy if exists versions_insert on public.submission_versions;
create policy versions_insert on public.submission_versions
  for insert to authenticated
  with check (
    public.is_admin()
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
  using (public.is_admin());

-- Преподаватель помечает файлы версий удалёнными после истечения срока хранения.
drop policy if exists versions_admin_update on public.submission_versions;
create policy versions_admin_update on public.submission_versions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Политики: annotations ----------
drop policy if exists annotations_select on public.annotations;
create policy annotations_select on public.annotations
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

-- Создавать/менять/удалять отметки может только преподаватель.
drop policy if exists annotations_admin_write on public.annotations;
create policy annotations_admin_write on public.annotations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- Журнал ----------
-- Студент видит только факты сдачи и оценки своей группы (без файлов и логинов).
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
where public.is_admin()
   or s.student_id = auth.uid()
   or s.student_id in (
     select p.id
     from public.profiles p
     where p.group_name = public.current_group()
       and p.role = 'student'
   );

revoke all on public.journal_entries from anon, authenticated;
grant select on public.journal_entries to authenticated;

-- ---------- Переименование группы (только админ) ----------
-- Выполняется security definer, чтобы каскадно обновить profiles/assignments
-- одной транзакцией и не зависеть от прав на колонки.
create or replace function public.rename_group(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text := btrim(p_new);
begin
  if not public.is_admin() then
    raise exception 'Только преподаватель может переименовать группу';
  end if;

  if v_new is null or char_length(v_new) < 1 or char_length(v_new) > 20 then
    raise exception 'Название группы должно быть длиной от 1 до 20 символов';
  end if;

  if not exists (select 1 from public.groups where name = p_old) then
    raise exception 'Группа % не найдена', p_old;
  end if;

  if p_old = v_new then
    return;
  end if;

  if exists (select 1 from public.groups where name = v_new) then
    raise exception 'Группа % уже существует', v_new;
  end if;

  update public.groups set name = v_new where name = p_old;
end;
$$;

revoke all on function public.rename_group(text, text) from public;
grant execute on function public.rename_group(text, text) to authenticated;
