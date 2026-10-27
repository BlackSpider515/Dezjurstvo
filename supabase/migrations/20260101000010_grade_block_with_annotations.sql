-- ============================================================
-- Запрет первой оценки, пока у работы есть активные замечания.
--
-- Активным считается замечание, созданное после последней
-- загруженной версии файла. Когда студент загружает новую версию,
-- старые замечания перестают блокировать оценку и статус
-- «Исправить» в журнале снимается автоматически.
--
-- Уже выставленную оценку можно изменить или снять: блокируется
-- только переход из «без оценки» в оценку. Это позволяет
-- преподавателю поправить оценку, не удаляя замечания.
--
-- Выполнить после 20260101000009_file_retention.sql.
-- Миграция идемпотентна: её можно запускать повторно.
-- ============================================================

create index if not exists annotations_submission_created_idx
  on public.annotations (submission_id, created_at);

create or replace function public.guard_grade_with_active_annotations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest_version timestamptz;
begin
  if new.grade is null then
    return new;
  end if;

  -- Оценка уже была — разрешаем изменить или переоценить.
  if old.grade is not null then
    return new;
  end if;

  select max(created_at) into v_latest_version
  from public.submission_versions
  where submission_id = new.id;

  if exists (
    select 1
    from public.annotations a
    where a.submission_id = new.id
      and (v_latest_version is null or a.created_at > v_latest_version)
  ) then
    raise exception 'Сначала исправьте замечания: пока они активны, оценку ставить нельзя';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_grade_with_active_annotations() from public;

drop trigger if exists submissions_guard_grade_annotations on public.submissions;
create trigger submissions_guard_grade_annotations
  before update of grade on public.submissions
  for each row execute function public.guard_grade_with_active_annotations();
