-- Приватные поля вкладки «Личные».
--
-- Не кладём их в resume_data: resume_data входит в публичную проекцию
-- кандидата для работодателя, а здесь могут появляться контактные,
-- демографические и иные чувствительные сведения. personal_data отдаётся
-- только владельцу через USER_SELF_COLS.
alter table public.jm_users
  add column if not exists personal_data jsonb not null default '{}'::jsonb;

comment on column public.jm_users.personal_data is
  'Приватная анкета владельца профиля. Не входит в публичную проекцию.';
