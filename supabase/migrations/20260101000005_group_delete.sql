-- ============================================================
-- Удаление группы преподавателем
-- Выполнить после 20260101000002_rls.sql
-- ============================================================

create or replace function public.delete_group(p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Недостаточно прав для удаления группы';
  end if;

  if not exists (select 1 from public.groups where name = p_name) then
    raise exception 'Группа % не найдена', p_name;
  end if;

  -- Не даём потерять студентов: профиль не может существовать без группы,
  -- поэтому непустую группу удалять нельзя.
  if exists (
    select 1
    from public.profiles
    where group_name = p_name and role = 'student'
  ) then
    raise exception 'В группе есть студенты. Сначала переведите или удалите студентов, затем удалите группу.';
  end if;

  -- Задания удалятся каскадно. Студентов в группе нет, поэтому сдач и файлов
  -- в Storage у этой группы быть не может.
  delete from public.groups where name = p_name;
end;
$$;

revoke all on function public.delete_group(text) from public;
grant execute on function public.delete_group(text) to authenticated;
