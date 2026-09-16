-- ФосАгро, Селектел и Lesta Games — из той же кучи «список нашли, адрес не
-- угадали». Адрес в каждом случае подобран по живой странице каталога и
-- проверен настоящий против выдуманного.
--
--   ФосАгро   /career-education/vacancies/detail/.../274032/ → 200 с названием
--             должности, тот же путь с выдуманным номером → 301 мимо;
--   Селектел  /careers/all/vacancy/1918/ → заголовок страницы «Вакансия:
--             Младший системный инженер ИТО», у выдуманного номера заголовок
--             обрывается на «Вакансия:» — то есть страница пустая;
--   Lesta     /vacancy/{slug}/{id} → 200 с названием, выдуманный id → 200 без
--             него.
--
-- Разбор всех трёх прогнан production-кодом cf_json_items на живых ответах:
-- ФосАгро даёт 11 карточек на странице, Селектел 23, Lesta 15.
--
-- Постраничная выдача проверена сравнением идентификаторов, а не на веру: у
-- ФосАгро вторая страница не повторяет первую ни одной записью (всего 336
-- вакансий на 28 страницах), у Lesta так же (всего 55). Селектел отдаёт все 23
-- разом при per_page=1000, листать нечего.
--
-- Ни одного из трёх в карантине нет — это чистые добавления.

begin;

update public.jm_ext_sources s
   set connector_config = jsonb_set(
         s.connector_config,
         '{endpoints}',
         (s.connector_config->'endpoints') || (
           select coalesce(jsonb_agg(c.value order by c.ord), '[]'::jsonb)
             from jsonb_array_elements(jsonb_build_array(
               jsonb_build_object(
                 'url', 'https://www.phosagro.ru/api/vacancies?page=1',
                 'paging', jsonb_build_object('type', 'page', 'param', 'page', 'start', 1, 'limit', 12),
                 'map', jsonb_build_object(
                   'list', 'items',
                   'title', 'name',
                   'address', 'address',
                   'schedule', 'workDays',
                   'pay', 'wage',
                   'url_template', 'https://www.phosagro.ru/career-education/vacancies/{link}',
                   'company_const', 'ФосАгро'
                 )
               ),
               jsonb_build_object(
                 'url', 'https://api.selectel.ru/proxy/public/employee/api/public/vacancies?per_page=1000&page=1&brand=selectel',
                 'map', jsonb_build_object(
                   'list', 'items',
                   'title', 'title',
                   'id', 'id',
                   'address', 'city',
                   'schedule', 'timetable_mode',
                   'url_template', 'https://selectel.ru/careers/all/vacancy/{id}/',
                   'company_const', 'Селектел'
                 )
               ),
               jsonb_build_object(
                 'url', 'https://join.lesta.team/filters?offset=0&limit=15',
                 'paging', jsonb_build_object('type', 'offset', 'param', 'offset', 'limit_param', 'limit', 'limit', 15),
                 'map', jsonb_build_object(
                   'list', 'vacancies',
                   'title', 'title',
                   'id', 'id',
                   'address', 'location_city',
                   'url_template', 'https://join.lesta.team/vacancy/{slug}/{id}',
                   'company_const', 'Lesta Games'
                 )
               )
             )) with ordinality as c(value, ord)
            where not exists (
              select 1
                from jsonb_array_elements(s.connector_config->'endpoints') e
               where e->>'url' = c.value->>'url'
            )
         ))
 where s.id = 'career'
   and jsonb_typeof(s.connector_config->'endpoints') = 'array';

commit;

notify pgrst, 'reload schema';
