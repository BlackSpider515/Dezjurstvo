-- ============================================================
-- Системы оценивания и полный дедлайн задания
--   stars     — оценки 1–5
--   pass_fail — зачёт (1) / незачёт (0)
--   points    — баллы 0–100
--
-- Выполнить после 20260101000007_submission_hardening.sql.
-- Миграция идемпотентна: её можно запускать повторно.
-- ============================================================

alter table public.assignments
  add column if not exists grade_type text not null default 'stars';

alter table public.assignments
  drop constraint if exists assignments_grade_type_check;

alter table public.assignments
  add constraint assignments_grade_type_check
  check (grade_type in ('stars', 'pass_fail', 'points'));

alter table public.assignments
  add column if not exists due_at timestamptz;

create index if not exists assignments_due_at_idx
  on public.assignments (due_at)
  where due_at is not null;

-- Старая оценка была smallint 1..5. Для баллов нужны 0..100,
-- а для зачёта/незачёта используются значения 1/0.
alter table public.submissions
  drop constraint if exists submissions_grade_check;

alter table public.submissions
  alter column grade type integer using grade::integer;

alter table public.submissions
  add constraint submissions_grade_check
  check (grade is null or grade between 0 and 100);

-- Проверяем оценку по системе конкретного задания.
create or replace function public.validate_submission_grade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grade_type text;
begin
  if new.grade is null then
    return new;
  end if;

  select grade_type into v_grade_type
  from public.assignments
  where id = new.assignment_id;

  if v_grade_type is null then
    raise exception 'Задание для оценки не найдено';
  end if;

  if v_grade_type = 'stars' and (new.grade < 1 or new.grade > 5) then
    raise exception 'Для этого задания оценка должна быть от 1 до 5';
  end if;

  if v_grade_type = 'points' and (new.grade < 0 or new.grade > 100) then
    raise exception 'Для этого задания балл должен быть от 0 до 100';
  end if;

  if v_grade_type = 'pass_fail' and new.grade not in (0, 1) then
    raise exception 'Для этого задания доступны только «Зачёт» и «Незачёт»';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_submission_grade() from public;

drop trigger if exists submissions_validate_grade on public.submissions;
create trigger submissions_validate_grade
  before insert or update on public.submissions
  for each row execute function public.validate_submission_grade();

-- Нельзя переключить систему оценивания, если по заданию уже есть оценки:
-- иначе старые значения станут неоднозначными (например, 3 при «Зачёт/Незачёт»).
create or replace function public.guard_assignment_grade_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.grade_type is distinct from old.grade_type
     and exists (
       select 1
       from public.submissions
       where assignment_id = new.id and grade is not null
     ) then
    raise exception 'Нельзя менять систему оценивания после выставления оценок';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_assignment_grade_type() from public;

drop trigger if exists assignments_guard_grade_type on public.assignments;
create trigger assignments_guard_grade_type
  before update of grade_type on public.assignments
  for each row execute function public.guard_assignment_grade_type();
