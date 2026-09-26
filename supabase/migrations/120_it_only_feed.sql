-- Лента только IT (решение владельца 26.09.2026, как у Cofinder и Sorce).
--
-- IT — это раздел «it» (по названию вакансии, php-proxy/job_sections.php)
-- ПЛЮС все вакансии IT-компаний: дизайнер, продакт или маркетолог в
-- Яндексе — тоже IT-вакансия, а по названию она в раздел it не попадает
-- (у Яндекса это 391 из 854). Список IT-компаний — таблица, а не код:
-- добавить компанию можно одной строкой insert, без выкладки.
--
-- Смешанные работодатели (Сбер, МТС, Альфа, Магнит…) в список не входят:
-- от них в ленту идёт только раздел it.
begin;

create table if not exists public.jm_it_companies (
  company text primary key,
  added_at timestamptz not null default now()
);
alter table public.jm_it_companies enable row level security;
revoke all on public.jm_it_companies from anon, authenticated;
grant all on public.jm_it_companies to service_role;

-- Названия — ровно как в jm_ext_vacancies.company (company_const записей
-- scripts/career-endpoints.json и названия каталога scripts/career-sites.tsv).
insert into public.jm_it_companies (company) values
  ('Яндекс'), ('Т-Банк'), ('VK'), ('Авито'), ('Avito'), ('Контур'), ('Kaspersky'),
  ('Селектел'), ('Yadro'), ('IBS'), ('Navio'), ('Lesta Games'), ('Bell Integrator'),
  ('Mish'), ('Orion soft'), ('Авиасейлс'), ('Техвилл'), ('Koronatech'), ('X5 Tech'),
  ('Inline Group'), ('Performance Lab'), ('КРОК'), ('ITG'), ('Centicore Group'),
  ('iSpring'), ('Just AI'), ('amoCRM'), ('2ГИС'), ('Globus IT'), ('UserGate'),
  ('Профи.ру'), ('Arenadata'), ('ИнфоТеКС'), ('МойСклад'), ('Aston'),
  ('Evercode Lab'), ('Softline'), ('Notamedia'), ('Twinby'), ('Наумен'), ('Rubius'),
  ('RedLab'), ('BINOM'), ('PIX Robotics'), ('Пачка'), ('IT_One'), ('Протей'),
  ('iFellow'), ('Cloud.ru'), ('КОРУС Консалтинг'), ('1С'), ('1С-Битрикс'),
  ('Agima'), ('Группа Астра'), ('Инфосистемы Джет'), ('TerraLink'), ('Солар'),
  ('С-Терра'), ('Юзтех'), ('Baum'), ('SimbirSoft'), ('Аурига'), ('Linx'),
  ('F.A.C.C.T.'), ('Angara Security'), ('Эвотор'), ('Т1'), ('Иви'), ('Positive Technologies'),
  ('Циан'), ('Ozon'), ('Тензор'), ('Selecty'), ('Axenix'), ('Лаборатория Касперского')
on conflict (company) do nothing;

-- Четвёртый аргумент — drop старой перегрузки, иначе (text,int,text[]) и
-- (text,int,text[],boolean) жили бы рядом (урок миграции 115).
drop function if exists public.jm_ext_feed_pool(text, int, text[]);

create or replace function public.jm_ext_feed_pool(
  p_user text, p_per_company int default 30, p_sections text[] default null,
  p_it_only boolean default false
)
returns setof public.jm_ext_vacancies
language sql stable security definer set search_path = public as $$
  select v.*
    from public.jm_ext_vacancies v
    join (
      select c.id,
             row_number() over (partition by coalesce(c.company, '')
                                order by c.first_seen_at desc, c.id) as rn
        from public.jm_ext_vacancies c
       where c.active
         and (p_sections is null or c.section = any(p_sections))
         and (not p_it_only or c.section = 'it'
              or exists (select 1 from public.jm_it_companies i where i.company = c.company))
         and (p_user is null or not exists (
               select 1 from public.jm_ext_swipes s
                where s.user_id = p_user and s.vacancy_id = c.id))
         and (p_user is null or not exists (
               select 1 from public.jm_jupiter_applications a
                where a.user_id = p_user and a.vacancy_url = c.url))
    ) r on r.id = v.id
   where r.rn <= greatest(1, least(p_per_company, 200));
$$;
revoke all on function public.jm_ext_feed_pool(text, int, text[], boolean) from public, anon, authenticated;
grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean) to service_role;

commit;
