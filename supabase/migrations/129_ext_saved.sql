-- Закладки карьерных вакансий (решение владельца 27.09.2026: кнопка
-- «Сохранить» в ленте и на «Вакансии подробно», как на макете JT-design).
--
-- Своя таблица, а не jm_perm_saved: там vacancy_id — вакансия JobToo, и
-- ссылки на jm_ext_vacancies у неё нет. Вакансия ушла из базы — закладка
-- уходит вместе с ней (on delete cascade), человек пропал — тоже.
-- Доступ только через db.php (сервисная роль), как у jm_ext_swipes.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

create table if not exists public.jm_ext_saved (
  user_id text not null references public.jm_users(id) on delete cascade,
  vacancy_id text not null references public.jm_ext_vacancies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vacancy_id)
);
create index if not exists jm_ext_saved_recent on public.jm_ext_saved (user_id, created_at desc);

alter table public.jm_ext_saved enable row level security;
revoke all on public.jm_ext_saved from anon, authenticated;

commit;
