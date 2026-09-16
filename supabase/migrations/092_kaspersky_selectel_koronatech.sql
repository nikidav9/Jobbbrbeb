-- Kaspersky, Селектел и Koronatech: прямые вакансии работодателей.
-- Проверено 2026-09-16 живыми карьерными страницами и карточками вакансий.
--
-- Kaspersky: careers.kaspersky.com/vacancies отдаёт 14 карточек на страницу,
-- всего 88 вакансий; прямые карточки /vacancy/<id>.
-- Селектел: selectel.ru/careers/all отдаёт 23 прямые карточки
-- /careers/all/vacancy/<id>/ без промежуточного агрегатора.
-- Koronatech: все 13 вакансий лежат в __NEXT_DATA__, даже если DOM сначала
-- показывает только 10; прямой URL строится из id как /vacancy/<id>/.

begin;

with endpoints(endpoint) as (
  values
    (jsonb_build_object(
      'url', 'https://careers.kaspersky.com/vacancies?page=0',
      'mode', 'html_links',
      'map', jsonb_build_object(
        'link_path', '/vacancy/',
        'link_regex', '~^/vacancy/[0-9]+/?(?:\\?.*)?$~',
        'company_const', 'Kaspersky',
        'min_title', 8
      ),
      'paging', jsonb_build_object(
        'type', 'page',
        'param', 'page',
        'start', 0,
        'limit', 14,
        'max_pages', 10
      ),
      'company_hint', 'Kaspersky'
    )),
    (jsonb_build_object(
      'url', 'https://selectel.ru/careers/all',
      'mode', 'html_links',
      'map', jsonb_build_object(
        'link_path', '/careers/all/vacancy/',
        'link_regex', '~^/careers/all/vacancy/[0-9]+/?$~',
        'company_const', 'Селектел',
        'min_title', 8
      ),
      'company_hint', 'Селектел'
    )),
    (jsonb_build_object(
      'url', 'https://koronatech.ru/vacancy/',
      'mode', 'embedded',
      'map', jsonb_build_object(
        'list', 'props.pageProps.blocks.0.data.vacancies',
        'title', 'attributes.title',
        'id', 'id',
        'address', 'attributes.city.data.attributes.name',
        'company_const', 'Koronatech',
        'url_template', 'https://koronatech.ru/vacancy/{id}/'
      ),
      'company_hint', 'Koronatech'
    ))
), target as (
  select jsonb_agg(endpoint order by endpoint->>'company_hint') as additions
  from endpoints
), rebuilt as (
  select
    s.id,
    coalesce(
      (
        select jsonb_agg(e order by ord)
          from jsonb_array_elements(coalesce(s.connector_config->'endpoints', '[]'::jsonb))
               with ordinality as old(e, ord)
         where coalesce(e->>'company_hint', '') not in ('Kaspersky', 'Селектел', 'Koronatech')
      ),
      '[]'::jsonb
    ) || target.additions as endpoints
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
