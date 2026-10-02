-- Логотипы компаний (решение владельца 02.10.2026): в базе, а не только в
-- сборке приложения — новые и обновлённые логотипы видны без выпуска версии.
--
-- Картинки — PNG 256×256 в публичном бакете company-logos (карточка ленты
-- 52 pt, подробности 64 pt: на экранах 3× это до 192 px). Источник —
-- сайт самой компании, иначе Викисклад; каждый логотип просмотрен глазами,
-- проверенный набор лежит в репозитории (data/company-logos). Пишет только
-- сервер (adminCompanyLogoPut), отдаёт открытая dbCompanyLogos.
create table if not exists public.jm_company_logos (
  company_key  text primary key,          -- название в нижнем регистре, как в ленте
  company      text not null,
  storage_path text not null,
  source       text not null check (source in ('site', 'wikimedia')),
  source_url   text not null,
  updated_at   timestamptz not null default now()
);

alter table public.jm_company_logos enable row level security;
revoke all on public.jm_company_logos from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do update set public = true;
