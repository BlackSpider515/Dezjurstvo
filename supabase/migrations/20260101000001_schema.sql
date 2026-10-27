-- ============================================================
-- Электронный дневник — схема данных
-- Выполните этот файл в Supabase SQL Editor (по порядку с остальными).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Группы ----------
create table if not exists public.groups (
  name       text primary key check (char_length(btrim(name)) between 1 and 20),
  created_at timestamptz not null default now()
);

-- ---------- Профили ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'student' check (role in ('student', 'admin')),
  full_name  text not null check (char_length(btrim(full_name)) between 3 and 150),
  group_name text references public.groups (name) on update cascade on delete restrict,
  login      text unique,
  created_at timestamptz not null default now(),
  constraint profiles_student_has_group check (role = 'admin' or group_name is not null)
);

-- Один студент с одинаковым ФИО в одной группе — только один раз.
create unique index if not exists profiles_student_unique_name_group
  on public.profiles (lower(btrim(full_name)), group_name)
  where role = 'student';

create index if not exists profiles_group_idx on public.profiles (group_name) where role = 'student';

-- ---------- Задания ----------
create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  description   text not null default '',
  group_name    text not null references public.groups (name) on update cascade on delete cascade,
  subject       text not null default 'Учебная дисциплина',
  grade_type    text not null default 'stars' check (grade_type in ('stars', 'pass_fail', 'points')),
  assigned_date date not null default current_date,
  lesson_number smallint not null default 1 check (lesson_number between 1 and 4),
  due_at        timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists assignments_group_date_idx
  on public.assignments (group_name, assigned_date, lesson_number);

-- ---------- Работы студентов ----------
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  file_path     text,
  original_name text,
  mime          text,
  size          bigint check (size is null or size > 0),
  submitted_at  timestamptz not null default now(),
  grade         integer check (grade between 0 and 100),
  status        text not null default 'submitted'
                check (status in ('submitted', 'reviewed', 'revoked')),
  version       integer not null default 1 check (version >= 1),
  reviewed_at   timestamptz,
  file_deleted_at timestamptz,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists submissions_student_idx on public.submissions (student_id);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id);
create index if not exists submissions_submitted_idx on public.submissions (submitted_at desc);

-- ---------- История версий файлов ----------
create table if not exists public.submission_versions (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  file_path     text,
  original_name text,
  mime          text,
  size          bigint,
  version       integer not null,
  created_at    timestamptz not null default now(),
  file_deleted_at timestamptz
);

create index if not exists submission_versions_submission_idx
  on public.submission_versions (submission_id, version desc);

-- ---------- Аннотации преподавателя («Маркер») ----------
create table if not exists public.annotations (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  kind          text not null default 'pdf' check (kind in ('pdf', 'text')),
  page          integer check (page is null or page >= 1),
  rects         jsonb,          -- PDF: [{x,y,w,h}] в долях страницы 0..1
  range         jsonb,          -- DOCX/TXT: {start,end,text}
  color         text not null default '#f2b705',
  comment       text not null default '',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint annotations_payload check (rects is not null or range is not null)
);

create index if not exists annotations_submission_idx on public.annotations (submission_id);
create index if not exists annotations_submission_created_idx
  on public.annotations (submission_id, created_at);

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists submissions_touch_updated_at on public.submissions;
create trigger submissions_touch_updated_at
  before update on public.submissions
  for each row execute function public.touch_updated_at();


