-- Лента «офис рядом с IT» (решение владельца 02.10.2026): к it и marketing
-- добавлены финансы (finance), HR (hr) и юристы (legal). Разделы hr и legal
-- выделены из office в php-proxy/job_sections.php; администраторы, ассистенты,
-- закупки остаются в office и в ленту не идут. Операционисты и кредитные
-- специалисты банков из finance ушли в sales — это работа с клиентами.
-- Разделы пересчитываются при каждом сборе (ingest.php кладёт section в upsert),
-- поэтому отдельного переноса данных нет.
-- Список разделов — JOB_SECTIONS_FEED, совпадение сверяет
-- tests/it_only_feed_test.php. Тело — как в миграции 143, изменено только
-- условие разделов.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

create or replace function public.jm_ext_feed_pool(
  p_user text, p_per_company int default 30, p_sections text[] default null,
  p_it_only boolean default false, p_moscow_only boolean default false,
  p_hide_seen boolean default true
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
         and (not p_it_only or c.section in ('it', 'marketing', 'finance', 'hr', 'legal')
              or (exists (select 1 from public.jm_it_companies i where i.company = c.company)
                  and c.section not in ('warehouse', 'delivery', 'transport', 'retail',
                                        'food', 'production', 'service', 'medical')))
         and (not p_moscow_only or c.metro_station_norm is not null
              or coalesce(btrim(c.address), '') = ''
              or c.address ~* '([Мм]оскв|МОСКВ|[Mm]oscow|MOSCOW|[Зз]еленоград|ЗЕЛЕНОГРАД|[Уу]дал[её]н|УДАЛ[ЕЁ]Н|[Rr]emote|REMOTE|[Дд]истанц|ДИСТАНЦ)')
         and (p_user is null or not exists (
               select 1 from public.jm_ext_swipes s
                where s.user_id = p_user and s.vacancy_id = c.id
                  and (p_hide_seen or s.dir = 1)))
         and (p_user is null or not exists (
               select 1 from public.jm_jupiter_applications a
                where a.user_id = p_user and a.vacancy_url = c.url))
    ) r on r.id = v.id
   where r.rn <= greatest(1, least(p_per_company, 5000));
$$;
revoke all on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean) to service_role;

commit;
