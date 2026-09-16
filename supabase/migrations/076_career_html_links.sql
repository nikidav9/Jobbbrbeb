-- Ещё 18 компаний: вакансии, выложенные обычными ссылками.
--
-- Третий вид источника (`mode: html_links`) против двух прежних — разметки
-- JobPosting и JSON API. Появился он не из любви к разнообразию, а по замеру:
-- из 111 карьерных сайтов разметку JobPosting держат ДВОЕ, JSON отдают
-- единицы, зато у двух десятков список вакансий лежит обычными ссылками
-- `<a href="/vacancy/...">Должность</a>`.
--
-- Каждая ссылка проверена так же, как проверялись адреса после случая со
-- Сбером: открываю ссылку на настоящую вакансию и ссылку той же формы с
-- выдуманным хвостом. Засчитано, только если настоящая страница показывает
-- заголовок именно этой вакансии, а выдуманная — нет (или отвечает ошибкой,
-- или заметно отличается длиной).
--
-- Строгость этой проверки стоила двух третей улова: ссылки нашлись у 44
-- компаний, подтвердились у 19. Остальные 25 отдают одну и ту же страницу на
-- любой адрес, и доказать, что ссылка ведёт к вакансии, нечем. Лучше меньше,
-- чем карточка, ведущая в никуда.
--
-- Добавлено (число — вакансий на первой странице):
--    68  Контур
--    66  Яндекс
--    51  IBS
--    34  Navio
--    28  Orion soft
--    25  Bell Integrator
--    25  Техвилл
--    17  Mish
--    12  Inline Group
--    12  BSL
--    10  X5 Tech
--     9  Cloud.ru
--     8  iSpring
--     7  Островок
--     6  kokos group
--     5  1С
--     5  Performance Lab
--     5  Just AI
--
-- Итого источников: 25. Вакансий на первых страницах около 700, дальше
-- листание доберёт остальное у тех, кто его поддерживает.

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
        "url_template": "https://job.rt.ru/vacancy/{id}",
        "company_const": "Ростелеком"
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
        "url_template": "https://careers.yadro.com/vacancy/{slug}",
        "company_const": "Yadro"
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
      "url": "https://career.rwb.ru/hr-crm-api/api/v2/pub/vacancies",
      "map": {
        "list": "data.items",
        "title": "name",
        "id": "id",
        "address": "city_title",
        "schedule": "employment_types",
        "url_template": "https://career.rwb.ru/vacancy/{id}",
        "company_const": "Wildberries"
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
        "address": "region",
        "company": "employer",
        "url_template": "https://job.mts.ru/vacancy/{slug}",
        "company_const": "МТС"
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
      "url": "https://job.lamoda.ru/api/hr/vacancies/compact",
      "map": {
        "list": "data",
        "title": "name",
        "id": "slug",
        "address": "location",
        "company": "department",
        "url_template": "https://job.lamoda.ru/vacancies/{slug}",
        "company_const": "Lamoda"
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
        "url_template": "https://www.aviasales.ru/about/vacancies/{id}",
        "company_const": "Авиасейлс"
      },
      "company_hint": "Авиасейлс"
    },
    {
      "url": "https://job.megafon.ru/api/v1/vacancies",
      "map": {
        "list": "vacancies",
        "title": "title",
        "id": "slug",
        "url_template": "https://job.megafon.ru/vacancy/{slug}",
        "company_const": "МегаФон"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit": 10,
        "max_pages": 110
      },
      "company_hint": "МегаФон"
    },
    {
      "url": "https://kontur.ru/career/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Контур",
        "min_title": 8
      },
      "company_hint": "Контур"
    },
    {
      "url": "https://yandex.ru/jobs/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/jobs/",
        "company_const": "Яндекс",
        "min_title": 8
      },
      "company_hint": "Яндекс"
    },
    {
      "url": "https://ibs.ru/career/jobs",
      "mode": "html_links",
      "map": {
        "link_path": "/jobs/",
        "company_const": "IBS",
        "min_title": 8
      },
      "company_hint": "IBS"
    },
    {
      "url": "https://navio.auto/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Navio",
        "min_title": 8
      },
      "company_hint": "Navio"
    },
    {
      "url": "https://career.orionsoft.ru/vacancy",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "Orion soft",
        "min_title": 8
      },
      "company_hint": "Orion soft"
    },
    {
      "url": "https://bellintegrator.ru/information/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "Bell Integrator",
        "min_title": 8
      },
      "company_hint": "Bell Integrator"
    },
    {
      "url": "https://techvill.ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Техвилл",
        "min_title": 8
      },
      "company_hint": "Техвилл"
    },
    {
      "url": "https://mish.design/ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Mish",
        "min_title": 8
      },
      "company_hint": "Mish"
    },
    {
      "url": "https://inlinegroup.ru/about/jobs",
      "mode": "html_links",
      "map": {
        "link_path": "/jobs/",
        "company_const": "Inline Group",
        "min_title": 8
      },
      "company_hint": "Inline Group"
    },
    {
      "url": "https://bsl.dev/vacancies.html",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "BSL",
        "min_title": 8
      },
      "company_hint": "BSL"
    },
    {
      "url": "https://x5.tech/vacancy",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "X5 Tech",
        "min_title": 8
      },
      "company_hint": "X5 Tech"
    },
    {
      "url": "https://cloud.ru/career/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Cloud.ru",
        "min_title": 8
      },
      "company_hint": "Cloud.ru"
    },
    {
      "url": "https://www.ispring.ru/company/jobs/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/jobs/",
        "company_const": "iSpring",
        "min_title": 8
      },
      "company_hint": "iSpring"
    },
    {
      "url": "https://career.ostrovok.ru/vacancy",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "Островок",
        "min_title": 8
      },
      "company_hint": "Островок"
    },
    {
      "url": "https://career.kokocgroup.ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "kokos group",
        "min_title": 8
      },
      "company_hint": "kokos group"
    },
    {
      "url": "https://1c.ru/rus/firm1c/vacan/search",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "1С",
        "min_title": 8
      },
      "company_hint": "1С"
    },
    {
      "url": "https://www.performance-lab.ru/vacancy",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/",
        "company_const": "Performance Lab",
        "min_title": 8
      },
      "company_hint": "Performance Lab"
    },
    {
      "url": "https://careers.just-ai.com/vakansii",
      "mode": "html_links",
      "map": {
        "link_path": "/vakansii/",
        "company_const": "Just AI",
        "min_title": 8
      },
      "company_hint": "Just AI"
    }
  ]
}'::jsonb,
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career';

commit;

notify pgrst, 'reload schema';
