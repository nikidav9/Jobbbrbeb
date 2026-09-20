-- Приватный сейф PDF-резюме пользователя.
--
-- Структурированное выбранное резюме по-прежнему дублируется в jm_users:
-- это публичная проекция для профиля кандидата. Сами PDF и список версий
-- приватны и доступны только владельцу через php-proxy.
create table if not exists public.jm_resume_files (
  id           text primary key,
  user_id      text not null references public.jm_users(id) on delete cascade,
  file_name    text not null,
  storage_path text not null unique,
  resume_data  jsonb not null,
  resume_email text,
  imported_at  timestamptz not null default now(),
  selected     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists jm_resume_files_user_updated_idx
  on public.jm_resume_files (user_id, updated_at desc);

create unique index if not exists jm_resume_files_one_selected_per_user
  on public.jm_resume_files (user_id)
  where selected = true;

alter table public.jm_resume_files enable row level security;
revoke all on public.jm_resume_files from anon, authenticated;

-- Исходные PDF — только в закрытом бакете.
insert into storage.buckets (id, name, public)
values ('resume-files', 'resume-files', false)
on conflict (id) do update set public = false;
