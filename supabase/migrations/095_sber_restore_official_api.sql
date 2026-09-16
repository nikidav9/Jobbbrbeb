-- Сбер: вернуть полный публичный employer API после исправления CDN edge failover.
--
-- Миграция 094 временно переключила источник на developers.sber.ru, потому что
-- московский backend попадал на CDN edge rabota.sber.ru, отвечавший 404. Это
-- лечится в career.php безопасным перебором только уже проверенных публичных
-- DNS edge (PR #129), поэтому ограниченный Developers-каталог больше не нужен.
--
-- Проверено 2026-09-16:
-- GET https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications?skip=0&take=1
-- => HTTP 200, data.total=3466; internalId=4570914 открывает конкретную вакансию
-- https://rabota.sber.ru/search/vacancy-4570914/ (редирект на канонический slug).

begin;

with endpoint as (
  select jsonb_build_object(
    'url', 'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications',
    'mode', 'json',
    'map', jsonb_build_object(
      'list', 'data.vacancies',
      'title', 'title',
      'id', 'internalId',
      'address', 'city',
      'description', 'introduction',
      'pay', 'salary_min',
      'company_const', 'Сбер',
      'url_template', 'https://rabota.sber.ru/search/vacancy-{internalId}/'
    ),
    'paging', jsonb_build_object(
      'type', 'offset',
      'param', 'skip',
      'limit_param', 'take',
      'limit', 100,
      'max_pages', 50
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
       -- Принудительно запустить полный каталог сразу после deploy.
       last_run_at = case when s.id = 'career_owner' then null else s.last_run_at end,
       consecutive_failures = case when s.id = 'career_owner' then 0 else s.consecutive_failures end
  from rebuilt
 where s.id = rebuilt.id;

commit;
