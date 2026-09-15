-- Девять карьерных источников включены по-настоящему.
--
-- До этой миграции раздел «Работа» был пуст, и виновата была не настройка.
-- `career.php` умел ровно один вид источника — разметку schema.org JobPosting
-- на странице. Разбор JSON (`cf_json_items`) лежал рядом в career_feed.php,
-- но в точку входа подключён не был: найденный разведкой адрес API вписывать
-- было НЕКУДА. Этим коммитом `endpoints` подключены, добавлено листание
-- порций, и вот первые девять адресов.
--
-- Каждый проверен живым запросом: карта полей разобрала настоящий ответ,
-- вторая порция отдала другие вакансии, а не те же самые.
--
--   Сбер        1795 у конкурента, порции по 100 (take/skip)
--   МТС         2553 по их же счётчику; см. оговорку ниже
--   МегаФон     1013, страницами по 10
--   Yadro        221, порциями по 100
--   Ростелеком   382, страницами по 20 — есть «Бригадир монтажников»
--   Lamoda       порциями по 100
--   Wildberries   97, порциями по 50 — есть «Повар»
--   Авиасейлс     25 одним куском
--   2ГИС          15 одним куском
--
-- Оговорка про МТС, записанная честно. Их API тасует выдачу: два запроса
-- подряд к одной и той же `page=1` дают разные вакансии (замерено). Полного
-- перебора это не даёт, но и вреда нет: ingest кладёт вакансии с ключом
-- (source_id, external_id), поэтому повторы схлопываются, а покрытие
-- накапливается от обхода к обходу.
--
-- Размер порции у Wildberries — 50, хотя просить можно 100: сервер всё равно
-- отдаёт 50. Важнее другое: из этих 50 наш отсев оставляет 31, и обход по
-- ПРИНЯТЫМ решил бы, что порция неполная, и бросил бы работу на первой
-- полусотне из 97. Поэтому считаются сырые записи ответа. Проверено: стало 75
-- вакансий вместо 31.

begin;

update public.jm_ext_sources
   set connector_config = '{
  "pages": [],
  "endpoints": [
    {
      "url": "https://job.rt.ru/backend/api/vacancies",
      "map": {
        "list": "vacancies",
        "title": "name",
        "id": "id",
        "address": "city",
        "description": "whatWeToDo",
        "company": "directions",
        "url_template": "https://job.rt.ru/vacancy/{id}"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit": 20,
        "max_pages": 25
      },
      "company_hint": "Ростелеком"
    },
    {
      "url": "https://careers.yadro.com/api/v1/vacancies/",
      "map": {
        "list": "results",
        "title": "title",
        "id": "slug",
        "address": "city",
        "description": "description",
        "schedule": "empl",
        "company": "direction",
        "url_template": "https://careers.yadro.com/vacancy/{slug}"
      },
      "paging": {
        "type": "offset",
        "param": "offset",
        "limit_param": "limit",
        "limit": 100,
        "max_pages": 10
      },
      "company_hint": "Yadro"
    },
    {
      "url": "https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications",
      "map": {
        "list": "data.vacancies",
        "title": "title",
        "id": "publicationId",
        "address": "city",
        "description": "introduction",
        "company": "company",
        "url_template": "https://rabota.sber.ru/vacancy/{publicationId}"
      },
      "paging": {
        "type": "offset",
        "param": "skip",
        "limit_param": "take",
        "limit": 100,
        "max_pages": 25
      },
      "company_hint": "Сбер"
    },
    {
      "url": "https://career.rwb.ru/hr-crm-api/api/v2/pub/vacancies",
      "map": {
        "list": "data.items",
        "title": "direction_role_title",
        "id": "id",
        "address": "city_title",
        "company": "direction_title",
        "schedule": "experience_type_title",
        "url_template": "https://career.rwb.ru/vacancy/{id}"
      },
      "paging": {
        "type": "offset",
        "param": "offset",
        "limit_param": "limit",
        "limit": 50,
        "max_pages": 20
      },
      "company_hint": "Wildberries"
    },
    {
      "url": "https://job.mts.ru/api/v2/vacancies",
      "map": {
        "list": "data",
        "title": "title",
        "id": "slug",
        "address": "cities",
        "company": "employer",
        "url_template": "https://job.mts.ru/vacancy/{slug}"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit": 25,
        "max_pages": 110
      },
      "company_hint": "МТС"
    },
    {
      "url": "https://job.2gis.ru/api/v1/vacancies",
      "map": {
        "list": "items",
        "title": "title",
        "id": "id",
        "url_template": "https://job.2gis.ru/vacancy/{id}",
        "description": "shortDescription"
      },
      "company_hint": "2ГИС"
    },
    {
      "url": "https://job.lamoda.ru/api/hr/vacancies/compact",
      "map": {
        "list": "data",
        "title": "name",
        "id": "slug",
        "address": "location",
        "company": "department",
        "url_template": "https://job.lamoda.ru/vacancy/{slug}"
      },
      "paging": {
        "type": "offset",
        "param": "pagination[start]",
        "limit_param": "pagination[limit]",
        "limit": 100,
        "max_pages": 10
      },
      "company_hint": "Lamoda"
    },
    {
      "url": "https://vacancies-app.aviasales.ru/api/vacancies?language=ru",
      "map": {
        "list": "",
        "title": "position",
        "id": "id",
        "address": "workPlace",
        "company": "team",
        "url_template": "https://www.aviasales.ru/about/vacancies/{id}"
      },
      "company_hint": "Авиасейлс"
    },
    {
      "url": "https://job.megafon.ru/api/v1/vacancies",
      "map": {
        "list": "vacancies",
        "title": "title",
        "id": "slug",
        "url_template": "https://job.megafon.ru/vacancy/{slug}"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit": 10,
        "max_pages": 110
      },
      "company_hint": "МегаФон"
    }
  ]
}'::jsonb,
       enabled = true,
       period_min = 360,
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career';

commit;

notify pgrst, 'reload schema';
