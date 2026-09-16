-- VK: 25 вакансий из состояния, встроенного в страницу.
--
-- Третий способ чтения рядом с JSON API и ссылками из разметки. Next.js кладёт
-- данные в <script id="__NEXT_DATA__">, Nuxt — в window.__NUXT__: для нас это
-- тот же JSON, только приехавший внутри HTML, и дальше его разбирает тот же
-- cf_json_items. Никакого отдельного запроса за вакансиями у таких сайтов нет
-- вовсе — всё приезжает первой же страницей.
--
-- Адрес вакансии проверен строго: /vacancy/52666 отдаёт 200 с названием
-- «Бизнес-ассистент», /vacancy/jobtoo-probe-404 — 404.
--
-- Тем же способом читаются ещё несколько, но взят пока только VK. Почему:
--
--   ВТБ (20 вакансий) — их карьерная страница это витрина hh: ссылка на
--     вакансию ведёт на hh.ru/vacancy/136824761, своей страницы вакансии у
--     сайта нет. Формально источник рабочий, но человек уедет к агрегатору,
--     от которых владелец решил уйти. Это его решение, не моё, — спрашиваю.
--
--   Кофемания (18 вакансий: Хостес, Бармен-Официант, Специалист по сборке
--     заказов) — отдельной страницы вакансии нет вообще: в данных лежит
--     `anchor` вида «hostess», а якоря на странице рисует скрипт, и проверить
--     адрес нечем. Все угаданные пути отвечают 404.
--
--   Островок, Хоулмонт, Twinby уже читаются другими способами.

begin;

update public.jm_ext_sources
   set connector_config = '{
  "pages": [],
  "endpoints": [
    {
      "url": "https://rabota5ka.ru/api/vacancy/hire-request",
      "map": {
        "list": "items",
        "title": "name",
        "id": "id",
        "address": "address",
        "pay": "salaryFrom",
        "description": "description",
        "schedule": "schedule",
        "company_const": "Пятёрочка",
        "url_template": "https://rabota5ka.ru/vacancy/{id}"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit_param": "limit",
        "limit": 100,
        "max_pages": 200
      },
      "company_hint": "Пятёрочка"
    },
    {
      "url": "https://rabota5ka.ru/gw/api/vacancy/hire-request?portals%5B0%5D=cross",
      "map": {
        "list": "items",
        "title": "name",
        "id": "id",
        "address": "address",
        "description": "description",
        "schedule": "schedule",
        "company_const": "Перекрёсток",
        "url_template": "https://rabota.perekrestok.ru/vacancies/{id}"
      },
      "paging": {
        "type": "page",
        "param": "page",
        "start": 1,
        "limit_param": "limit",
        "limit": 100,
        "max_pages": 50
      },
      "company_hint": "Перекрёсток"
    },
    {
      "url": "https://vkusvill.ru/job/vacancys",
      "mode": "html_links",
      "map": {
        "link_path": "/job/",
        "company_const": "ВкусВилл",
        "min_title": 8
      },
      "company_hint": "ВкусВилл"
    },
    {
      "url": "https://rabota.cdek.ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancies/item/",
        "company_const": "CDEK",
        "min_title": 8
      },
      "company_hint": "CDEK"
    },
    {
      "url": "https://rabota.lemanapro.ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "Лемана ПРО",
        "min_title": 8
      },
      "company_hint": "Лемана ПРО"
    },
    {
      "url": "https://career.nornickel.ru/vacancies",
      "mode": "html_links",
      "map": {
        "link_path": "/vacancy/",
        "company_const": "Норникель",
        "min_title": 8
      },
      "company_hint": "Норникель"
    },
    {
      "url": "https://www.maria-ra.ru/karera-v-seti/vakansii",
      "mode": "html_links",
      "map": {
        "link_path": "/vakansii/",
        "company_const": "Мария-Ра",
        "min_title": 8
      },
      "company_hint": "Мария-Ра"
    },
    {
      "url": "https://rabota.metro-cc.ru/SupportSrv/SupportSrv.svc/Support/v1/metro/vacancy?objtype=VacancyMetro",
      "method": "POST",
      "body": {},
      "map": {
        "list": "vacancy",
        "title": "vacancyName",
        "id": "vacancyId",
        "schedule": "chartOfWork",
        "pay": "salaryMin",
        "description": "responsibility",
        "company_const": "METRO",
        "url_template": "https://rabota.metro-cc.ru/vacancy/{vacancyId}"
      },
      "paging": {
        "type": "offset",
        "param": "line",
        "limit_param": "linesPerPage",
        "limit": 50,
        "max_pages": 10
      },
      "company_hint": "METRO"
    },
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
      "url": "https://inlinegroup.ru/about/jobs/",
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
    },
    {
      "url": "https://team.vk.company/vacancy",
      "mode": "embedded",
      "map": {
        "list": "props.pageProps.initialVacancies",
        "title": "title",
        "id": "id",
        "address": "town",
        "schedule": "work_format",
        "company_const": "VK",
        "url_template": "https://team.vk.company/vacancy/{id}"
      },
      "company_hint": "VK"
    }
  ]
}'::jsonb,
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career';

commit;

notify pgrst, 'reload schema';
