-- Петрович: прямой HTML-каталог вакансий работодателя.
--
-- Firecrawl-проверка 2026-09-16 увидела на https://petrovichjob.ru/vakancies/
-- 121 живую вакансию. Карточки имеют стабильный вид /vakancies/<numeric-id>/,
-- например /vakancies/58249/ и /vakancies/54328/. Рядом на той же странице
-- лежат разделы вида /vakancies/contact-center/, поэтому одного link_path
-- недостаточно: link_regex ниже оставляет только реальные карточки вакансий.
--
-- Обновляем и legacy `career` (он остаётся донором конфигурации для
-- infra/sync-career-catalog.sh), и рабочий `career_owner`, чтобы миграция была
-- полезна даже до следующей синхронизации каталога.

begin;

with target as (
  select jsonb_build_object(
    'url', 'https://petrovichjob.ru/vakancies/',
    'mode', 'html_links',
    'map', jsonb_build_object(
      'link_path', '/vakancies/',
      'link_regex', '~^/vakancies/[0-9]+/?$~',
      'company_const', 'Петрович',
      'min_title', 8
    ),
    'paging', jsonb_build_object(
      'type', 'page',
      'param', 'PAGEN_3',
      'start', 1,
      'limit', 10,
      'max_pages', 20
    ),
    'company_hint', 'Петрович'
  ) as endpoint
), rebuilt as (
  select
    s.id,
    coalesce(
      (
        select jsonb_agg(e order by ord)
          from jsonb_array_elements(coalesce(s.connector_config->'endpoints', '[]'::jsonb))
               with ordinality as old(e, ord)
         where coalesce(e->>'company_hint', '') <> 'Петрович'
      ),
      '[]'::jsonb
    ) || jsonb_build_array(target.endpoint) as endpoints
  from public.jm_ext_sources s
  cross join target
  where s.id in ('career', 'career_owner')
)
update public.jm_ext_sources s
   set connector_config = jsonb_set(
         coalesce(s.connector_config, '{}'::jsonb),
         '{endpoints}',
         rebuilt.endpoints,
         true
       )
  from rebuilt
 where s.id = rebuilt.id;

commit;
