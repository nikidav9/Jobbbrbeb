-- Правки по итогам проверки на проде.
--
-- Выкатил 25 источников и дёрнул коннектор на живом сервере — не «должно
-- работать», а посмотреть, что он реально отдаёт. Нашлись три поломки, две из
-- них я бы не увидел ни в одном тесте на выдуманных данных.
--
-- ЯНДЕКС УБРАН. Все 68 его «вакансий» оказались ссылками вида
-- /jobs/vacancies?profession=backend — это фильтры каталога, а заголовком шло
-- «Разработка», «Аналитика». Настоящих ссылок на вакансии в разметке нет
-- вовсе: там только навигация и иконки. Строгая проверка адреса его
-- пропустила, потому что проверяла, что ссылка ОТКРЫВАЕТСЯ, а не что за ней
-- вакансия. Код теперь отсекает такие ссылки сам (CF_SECTION_WORDS).
--
-- IBS: адрес исправлен на https://ibs.ru/career/jobs/ со слэшем. Без него
-- сервер отвечает 301 на http://ibs.ru/career/jobs/ — по http, а мы ходим
-- только по https и за редиректом не идём (это защита, а не недосмотр).
--
-- Третья поломка была в коде, а не в настройке: постоянное название компании
-- перебивалось полем из ответа, и в карточке Ростелекома стояло «Технический
-- блок» — направление, а не работодатель. У источников по ссылкам название
-- компании не подставлялось вовсе.
--
-- Источников остаётся 24.

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
      "url": "https://ibs.ru/career/jobs/",
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

-- Вакансии Яндекса убираем сразу: это категории каталога, а не работа.
delete from public.jm_ext_vacancies
 where source_id = 'career' and url like 'https://yandex.ru/jobs/%';

commit;

notify pgrst, 'reload schema';
