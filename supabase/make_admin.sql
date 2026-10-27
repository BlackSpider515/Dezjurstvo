-- ============================================================
-- Ручное назначение преподавателя (запасной способ).
--
-- Обычно преподаватель регистрируется сам на /#/admin: ФИО должно быть
-- в public.teacher_allowlist. Этот скрипт нужен только для восстановления
-- доступа или создания аккаунта вручную через Dashboard.
--
-- 1. Dashboard → Authentication → Users: создайте пользователя
--    ksenia@diary.local с паролем и подтвердите email.
-- 2. Выполните этот файл в SQL Editor.
-- ============================================================

with target as (
  select id, email
  from auth.users
  where email = 'ksenia@diary.local'
)
insert into public.profiles (id, role, full_name, group_name, login)
select id, 'admin', 'Потапова Ксения Андреевна', null, split_part(email, '@', 1)
from target
on conflict (id) do update
  set role = 'admin',
      full_name = 'Потапова Ксения Андреевна',
      group_name = null,
      login = coalesce(profiles.login, excluded.login);

-- Закрепляем ФИО в allowlist, чтобы регистрация не создала дубль.
update public.teacher_allowlist ta
set claimed_by = p.id,
    claimed_at = coalesce(ta.claimed_at, now())
from public.profiles p
where p.role = 'admin'
  and lower(btrim(p.full_name)) = lower(ta.full_name)
  and ta.claimed_by is null;

-- Проверка:
-- select id, role, full_name, login from public.profiles where role = 'admin';
-- select * from public.teacher_allowlist order by full_name;
