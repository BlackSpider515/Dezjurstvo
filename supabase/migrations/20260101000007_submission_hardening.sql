-- ============================================================
-- Ужесточение прав на сдачи и историю версий.
-- Выполнить после 20260101000006_neutral_subject.sql.
--
-- Нужно, если база создавалась до этого обновления: политики из
-- 20260101000002_rls.sql уже обновлены для новых установок, а этот файл
-- безопасно применяет те же правила к существующей базе (идемпотентно).
-- ============================================================

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
