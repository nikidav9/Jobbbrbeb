-- Сбер: вернуть прямой employer feed с рабочими карточками вакансий.
-- Проверено 2026-09-16 в браузере на rabota.sber.ru:
-- GET /public/app-candidate-public-api-gateway/api/v1/publications?skip=0&take=50
-- отдаёт 3467 активных публикаций в data.vacancies.
-- internalId детерминированно открывается как /search/vacancy-<internalId>/ и
-- редиректит на канонический slug конкретной вакансии (не на каталог).
--
-- Яндекс Лавка: старый одноразовый UPDATE уже не защищал от новых вариантов
-- названия. Канонизируем существующие строки и ставим BEFORE-trigger, чтобы
-- будущие обходы не возвращали ООО/регистр/кавычки отдельными компаниями.

begin;

create or replace function public.jm_canonical_ext_company(p_company text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select case
    when p_company is null then null
    when regexp_replace(
           lower(btrim(p_company)),
           $rx$[[:space:]"'«»().]+$rx$,
           '',
           'g'
         ) in ('лавка', 'яндекславка', 'ооолавка', 'ооояндекславка')
      then 'Яндекс Лавка'
    else nullif(btrim(p_company), '')
  end;
$fn$;

update public.jm_ext_vacancies
   set company = 'Яндекс Лавка'
 where public.jm_canonical_ext_company(company) = 'Яндекс Лавка'
   and company is distinct from 'Яндекс Лавка';

create or replace function public.jm_ext_vacancies_canonical_company_trg()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.company := public.jm_canonical_ext_company(new.company);
  return new;
end;
$fn$;

drop trigger if exists jm_ext_vacancies_canonical_company on public.jm_ext_vacancies;
create trigger jm_ext_vacancies_canonical_company
before insert or update of company on public.jm_ext_vacancies
for each row
execute function public.jm_ext_vacancies_canonical_company_trg();

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
       last_run_at = case when s.id = 'career_owner' then null else s.last_run_at end,
       consecutive_failures = case when s.id = 'career_owner' then 0 else s.consecutive_failures end
  from rebuilt
 where s.id = rebuilt.id;

commit;

notify pgrst, 'reload schema';
