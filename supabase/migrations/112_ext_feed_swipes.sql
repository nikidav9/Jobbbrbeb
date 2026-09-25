-- Свайпы по карьерным вакансиям и пул кандидатов для ленты.
--
-- Решение владельца 25.09.2026: смахнутая влево вакансия больше не
-- показывается, а её компания и похожие должности опускаются в ленте.
-- Вправо — тоже записываем: это отклик, и он же поднимает похожие.
create table if not exists public.jm_ext_swipes (
  user_id text not null references public.jm_users(id) on delete cascade,
  vacancy_id text not null references public.jm_ext_vacancies(id) on delete cascade,
  dir smallint not null check (dir in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, vacancy_id)
);
create index if not exists jm_ext_swipes_recent on public.jm_ext_swipes (user_id, created_at desc);

alter table public.jm_ext_swipes enable row level security;
revoke all on public.jm_ext_swipes from anon, authenticated;

-- Пул для ленты: у каждой компании не больше p_per_company самых свежих
-- вакансий, которые человек ещё не свайпал и на которые не откликался.
-- Ранжирует и чередует компании уже db.php (php-proxy/ext_feed.php): здесь
-- только отсечь просмотренное и не отдавать все 6–7 тысяч строк разом.
create or replace function public.jm_ext_feed_pool(p_user text, p_per_company int default 30)
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
         and (p_user is null or not exists (
               select 1 from public.jm_ext_swipes s
                where s.user_id = p_user and s.vacancy_id = c.id))
         and (p_user is null or not exists (
               select 1 from public.jm_jupiter_applications a
                where a.user_id = p_user and a.vacancy_url = c.url))
    ) r on r.id = v.id
   where r.rn <= greatest(1, least(p_per_company, 200));
$$;
revoke all on function public.jm_ext_feed_pool(text, int) from public, anon, authenticated;
-- revoke from public отнимает право и у service_role, через которую ходит
-- db.php (урок миграции 108: без этой строки каждый вызов ленты — HTTP 500).
grant execute on function public.jm_ext_feed_pool(text, int) to service_role;
grant all on public.jm_ext_swipes to service_role;
-- Страховка для истории откликов из 111: там явного права не было, работает
-- на правах по умолчанию. Явное право ничего не ломает.
grant all on public.jm_jupiter_events to service_role;
