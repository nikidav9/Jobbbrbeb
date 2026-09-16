-- Сбер и Yadro — из тех находок, где разведка нашла список, но не смогла
-- угадать адрес вакансии и поэтому пометила источник как непригодный.
--
-- Сбер — самый крупный источник из всех доступных: его открытое API отдаёт
-- total 3467. Листается честно, skip/take, без пересечений между страницами
-- (проверено: вторая сотня не повторяет первую ни одной записью).
--
-- Адрес вакансии у него собирается из internalId и отвечает 307 — постоянным
-- переходом на человеческий слаг: /search/vacancy-4567299/ уводит на
-- /search/rukovoditel-napravleniya-4567299/. Для человека это нормальная
-- рабочая ссылка. Выдуманный номер при этом отдаёт 404, то есть шаблон
-- подтверждён, а не просто «сайт жив».
--
-- Yadro отдаёт список по vacancies (разведка смотрела results и получала ноль)
-- и адрес /vacancy/{slug}: настоящий показывает название должности, выдуманный
-- — нет. Разбор обоих проверен production-кодом cf_json_items на живых
-- ответах, а не на глаз.
--
-- Про карантин, как и в 091. Сбера в карантине НЕТ вовсе — он чистое
-- добавление. Yadro есть: сегодня утром прод получил от него 477. Адрес здесь
-- другой (с siteId), поэтому карантин его пропустит, и следующий полный проход
-- покажет, отвечает ли он production-серверу. Не ответит — обход пропустит
-- источник, в career-runtime-smoke он появится в failed, и место ему обратно в
-- карантин с новым адресом.

begin;

update public.jm_ext_sources s
   set connector_config = jsonb_set(
         s.connector_config,
         '{endpoints}',
         (s.connector_config->'endpoints') || (
           select coalesce(jsonb_agg(c.value order by c.ord), '[]'::jsonb)
             from jsonb_array_elements(jsonb_build_array(
               jsonb_build_object(
                 'url', 'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications?skip=0&take=100',
                 'paging', jsonb_build_object(
                   'type', 'offset',
                   'param', 'skip',
                   'limit_param', 'take',
                   'limit', 100
                 ),
                 'map', jsonb_build_object(
                   'list', 'data.vacancies',
                   'title', 'title',
                   'id', 'internalId',
                   'description', 'introduction',
                   'url_template', 'https://rabota.sber.ru/search/vacancy-{internalId}/',
                   'company_const', 'Сбер'
                 )
               ),
               jsonb_build_object(
                 'url', 'https://careers.yadro.com/api/vacancies/?siteId=career',
                 'map', jsonb_build_object(
                   'list', 'vacancies',
                   'title', 'title',
                   'id', 'slug',
                   'address', 'city',
                   'description', 'description',
                   'schedule', 'empl',
                   'url_template', 'https://careers.yadro.com/vacancy/{slug}',
                   'company_const', 'Yadro'
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
