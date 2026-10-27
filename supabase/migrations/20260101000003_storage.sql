-- ============================================================
-- Приватный бакет для работ студентов и политики Storage
-- Путь объекта: {student_id}/{assignment_id}/{uuid}.{ext}
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions',
  'submissions',
  false,
  52428800, -- 50 МБ: лимит бесплатного плана Supabase
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.rar',
    'application/x-rar-compressed',
    'video/mp4',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- SELECT: владелец или админ ----------
drop policy if exists diary_submissions_select on storage.objects;
create policy diary_submissions_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- ---------- INSERT: только в свою папку и только по заданию своей группы ----------
drop policy if exists diary_submissions_insert on storage.objects;
create policy diary_submissions_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.assignments a
      where a.id::text = (storage.foldername(name))[2]
        and a.group_name = public.current_group()
    )
    and not exists (
      select 1
      from public.submissions s
      where s.student_id = auth.uid()
        and s.assignment_id::text = (storage.foldername(name))[2]
        and s.grade is not null
    )
  );

-- ---------- Админ: полный доступ к объектам ----------
drop policy if exists diary_submissions_admin_insert on storage.objects;
create policy diary_submissions_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'submissions' and public.is_admin());

drop policy if exists diary_submissions_admin_update on storage.objects;
create policy diary_submissions_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'submissions' and public.is_admin())
  with check (bucket_id = 'submissions' and public.is_admin());

drop policy if exists diary_submissions_admin_delete on storage.objects;
create policy diary_submissions_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'submissions' and public.is_admin());
