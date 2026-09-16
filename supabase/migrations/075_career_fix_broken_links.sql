-- Убраны битые ссылки, исправлены заголовки и города.
--
-- Владелец открыл вакансию Сбера в приложении и получил страницу «мы не нашли
-- страницу по вашему запросу». Проверил — так и есть: адрес
-- rabota.sber.ru/vacancy/{publicationId} отдаёт HTTP 404. Это нарушение нашего
-- же правила, записанного в cf_json_items: без пути к первоисточнику вакансию
-- не берём, иначе человек едет туда, где его не ждут.
--
-- После этого проверил ВСЕ девять адресов одинаково: открываю ссылку на
-- настоящую вакансию и ссылку той же формы с выдуманным хвостом. Если ответы
-- не отличаются, адрес ничего не доказывает.
--
--   Сбер     404. Других форм нет: ни /vacancies/, ни /publication/, ни
--            /search/vacancy/. Параметр ?publicationId= страница игнорирует —
--            ответ байт в байт равен голому /search. Поля со ссылкой в их
--            ответе нет вовсе. УБРАН.
--   2ГИС     404 по всем трём формам, slug в ответе отсутствует. УБРАН.
--   Lamoda   был 404: верный путь /vacancies/{slug}, а не /vacancy/{slug}.
--            ИСПРАВЛЕН, заголовок вакансии на странице теперь виден.
--
-- Остальные четыре (Yadro, МТС, Авиасейлс, МегаФон) открываются и показывают
-- заголовок именно этой вакансии. Ростелеком заголовок рисует скриптом, но
-- выдуманный адрес от настоящего отличает.
--
-- Wildberries отдаёт одну и ту же оболочку на любой путь, поэтому проверен
-- иначе: их же API /pub/vacancies/34863 возвращает вакансию, а
-- /pub/vacancies/99999999 — 404. Номер настоящий, маршрут у страницы есть.
--
-- Две ошибки в разборе, найденные заодно.
--
-- Wildberries: заголовком бралась КАТЕГОРИЯ. В ленту шло «Повар» вместо
-- «пекарь-тандырщик» — у всех вакансий направления одно и то же слово.
-- Настоящее название лежит в `name`, категория в `direction_role_title`.
-- Заодно вакансий стало 50 вместо 31: часть отсеивалась без заголовка.
--
-- МТС: город терялся. Он лежит в `region` как {id, documentId, title}, а
-- разбор искал только `name` и `@value`. Добавлен `title`, город появился.
--
-- Название компании теперь задаётся постоянной строкой (`company_const`): в
-- ответах его чаще всего нет, а в карточке «Wildberries» читается, а
-- «Карьерные страницы» — нет.

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
    }
  ]
}'::jsonb,
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career';

-- Вакансии удалённых источников убираем сразу, а не ждём, пока обход пометит
-- их неактивными: обходить их больше некому, а ссылка у них ведёт на 404.
delete from public.jm_ext_vacancies
 where source_id = 'career'
   and (url like 'https://rabota.sber.ru/%' or url like 'https://job.2gis.ru/%');

commit;

notify pgrst, 'reload schema';
