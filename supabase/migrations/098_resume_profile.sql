alter table public.jm_users
    add column if not exists resume_data jsonb,
    add column if not exists resume_email text,
    add column if not exists resume_file_name text,
    add column if not exists resume_imported_at timestamptz;

comment on column public.jm_users.resume_data is
    'Структурированные разделы резюме. Исходный PDF не хранится.';

comment on column public.jm_users.resume_email is
    'Email из резюме. Не входит в публичную проекцию профиля.';
