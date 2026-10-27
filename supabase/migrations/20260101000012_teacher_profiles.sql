-- ============================================================
-- Профили преподавателей, аватары и контактные данные
--
-- Выполнить после 20260101000011_disciplines.sql.
-- Миграция идемпотентна: её можно запускать повторно.
-- ============================================================

alter table public.profiles
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists bio text,
  add column if not exists avatar_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_contact_email_len'
  ) then
    alter table public.profiles
      add constraint profiles_contact_email_len
      check (contact_email is null or char_length(btrim(contact_email)) between 3 and 150);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_phone_len'
  ) then
    alter table public.profiles
      add constraint profiles_phone_len
      check (phone is null or char_length(btrim(phone)) between 5 and 30);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_len'
  ) then
    alter table public.profiles
      add constraint profiles_bio_len
      check (bio is null or char_length(btrim(bio)) <= 1000);
  end if;
end $$;

-- Преподаватель может читать и менять только свои контактные данные.
-- ФИО, роль и группу через этот набор прав изменить нельзя.
grant select (contact_email, phone, bio, avatar_path) on public.profiles to authenticated;
grant update (contact_email, phone, bio, avatar_path) on public.profiles to authenticated;

drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_admin_update_own on public.profiles;
create policy profiles_admin_update_own on public.profiles
  for update to authenticated
  using (public.is_admin() and id = auth.uid())
  with check (public.is_admin() and id = auth.uid());

-- Студентам разрешено видеть строки преподавателей только через
-- безопасную витрину ниже. Колоночные гранты не дают прочитать login.
drop policy if exists profiles_select_teachers on public.profiles;
create policy profiles_select_teachers on public.profiles
  for select to authenticated
  using (role = 'admin');

-- Безопасная витрина для студентов: только профили преподавателей,
-- без login, student-данных и служебных полей.
create or replace view public.teacher_profiles
with (security_barrier = true, security_invoker = true) as
select
  p.id,
  p.full_name,
  p.avatar_path,
  p.contact_email,
  p.phone,
  p.bio,
  p.created_at
from public.profiles p
where p.role = 'admin';

revoke all on public.teacher_profiles from anon, authenticated;
grant select on public.teacher_profiles to authenticated;

comment on view public.teacher_profiles is
  'Публичные профили преподавателей для студентов: ФИО, аватар, почта, телефон и описание.';

-- ---------- Аватары ----------
-- Аватары публичные: студент должен видеть фото преподавателя без signed URL.
-- Загружать, менять и удалять файлы может только сам преподаватель.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 МБ
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists diary_avatars_insert on storage.objects;
create policy diary_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists diary_avatars_update on storage.objects;
create policy diary_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists diary_avatars_delete on storage.objects;
create policy diary_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
