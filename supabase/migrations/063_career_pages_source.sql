-- Карьерные страницы работодателей как источник вакансий.
--
-- Пункт 5 плана развития: «Диверсификация источников. Уроки Jobr. Начинать с
-- карьерных страниц и систем найма». Jobr висел на API LinkedIn, LinkedIn
-- закрыл доступ — продукта не стало. Наша лента висит на api.hh.ru,
-- api.superjob.ru и opendata.trudvsem.ru ровно так же.
--
-- Карьерную страницу у нас не отключит посредник: мы берём её у самого
-- работодателя. Адреса страниц лежат в connector_config.pages и задаются в
-- панели — кода для нового работодателя не требуется.
--
-- period_min=360 — вакансии на карьерных страницах живут неделями, а страница
-- работодателя отвечает медленнее, чем API, и ходить к ней часто невежливо.
--
-- enabled=false намеренно, как было с hh.ru в миграции 058: сначала вручную
-- посмотреть, что именно отдают страницы, и только потом показывать людям.
-- Отдельно это решение владельца: тянуть ли страницы без спроса или только у
-- тех работодателей, кто сам дал ссылку.

insert into public.jm_ext_sources (
  id, name, url, enabled, period_min, environment,
  connector_kind, integration_mode, connector_config
) values (
  'career',
  'Карьерные страницы',
  'https://jobtoo.ru/api/career.php?source=career',
  false,
  360,
  'production',
  'career',
  'redirect',
  '{"pages": []}'::jsonb
)
on conflict (id) do update
set name = excluded.name,
    url = excluded.url,
    period_min = excluded.period_min,
    environment = excluded.environment,
    connector_kind = excluded.connector_kind;

notify pgrst, 'reload schema';
