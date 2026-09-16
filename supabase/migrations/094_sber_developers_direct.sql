-- Сбер: production-safe прямой источник работодателя.
--
-- Основной catalog API rabota.sber.ru живой в браузере, но из production
-- backend JobToo 2026-09-16 стабильно отвечал 404. Защиту/edge не обходим.
-- Вместо него используем другой официальный карьерный раздел самого Сбера:
-- https://developers.sber.ru/kak-v-sbere/vacancies
--
-- На странице 56 IT/AI/R&D вакансий. Полный список лежит в __NEXT_DATA__ по
-- props.pageProps.page.MainContent.0.vacancies; каждая запись имеет slug,
-- Title, City, Graphic и ведёт на конкретную страницу работодателя
-- /kak-v-sbere/vacancies/{slug}. Зарплату сознательно не маппим: у части
-- записей Salary заполнен, но ShowSalary=false, и скрытые данные показывать
-- пользователю нельзя.

begin;

with endpoint as (
  select jsonb_build_object(
    'url', 'https://developers.sber.ru/kak-v-sbere/vacancies',
    'mode', 'embedded',
    'map', jsonb_build_object(
      'list', 'props.pageProps.page.MainContent.0.vacancies',
      'title', 'Title',
      'id', 'slug',
      'address', 'City',
      'schedule', 'Graphic',
      'company_const', 'Сбер',
      'url_template', 'https://developers.sber.ru/kak-v-sbere/vacancies/{slug}'
    ),
    'company_hint', 'Сбер'
  ) as value
), rebuilt as (
  select
    s.id,
    coalesce(
      (
        select jsonb_agg(e order by ord)
          from jsonb_array_elements(coalesce(s.connector_config->'endpoints', '[]'::jsonb))
               with ordinality as old(e, ord)
         where coalesce(e->>'company_hint', '') <> 'Сбер'
      ),
      '[]'::jsonb
    ) || jsonb_build_array(endpoint.value) as endpoints
  from public.jm_ext_sources s
  cross join endpoint
  where s.id in ('career', 'career_owner')
)
update public.jm_ext_sources s
   set connector_config = jsonb_set(
         coalesce(s.connector_config, '{}'::jsonb),
         '{endpoints}',
         rebuilt.endpoints,
         true
       ),
       -- Чтобы после deploy не ждать очередные 6 часов полного каталога.
       last_run_at = case when s.id = 'career_owner' then null else s.last_run_at end,
       consecutive_failures = case when s.id = 'career_owner' then 0 else s.consecutive_failures end
  from rebuilt
 where s.id = rebuilt.id;

commit;
