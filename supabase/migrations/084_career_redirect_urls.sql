-- Три карьерные страницы отвечали редиректом, и обход их терял.
--
-- Мы намеренно не ходим за редиректом (CURLOPT_FOLLOWLOCATION => false): переход
-- увёл бы нас на адрес, который проверку на публичный HTTPS не проходил. Значит
-- адрес в настройке должен быть сразу конечным. Та же причина была у IBS и
-- Inline Group, там помог слэш.
--
-- Что именно отвечали (проверено запросом, а не догадкой):
--   ВкусВилл    /job/vacancys  → 301 на /job/vacancys/      — слэш
--   Норникель   /vacancies     → 301 на /vacancies/         — слэш
--   Лемана ПРО  /vacancies     → 307 на /vacancies/moskva-i-oblast
--
-- Про Леману честно: её редирект СУЖАЕТ выдачу до Москвы и области. Это выбор
-- самого сайта — без региона он вакансий не отдаёт вовсе. Берём с сужением и
-- записываем это здесь, чтобы через месяц не гадать, почему у Леманы только
-- московские смены.
--
-- Правка точечная: меняем адрес внутри нужного элемента endpoints, а не
-- переписываем настройку целиком. Прежние миграции перезаписывали весь JSON, и
-- каждая такая перезапись — шанс потерять то, что добавила соседняя.

begin;

update public.jm_ext_sources
   set connector_config = jsonb_set(
         connector_config,
         '{endpoints}',
         (select coalesce(jsonb_agg(
                    case e->>'url'
                      when 'https://vkusvill.ru/job/vacancys'
                        then jsonb_set(e, '{url}', '"https://vkusvill.ru/job/vacancys/"')
                      when 'https://career.nornickel.ru/vacancies'
                        then jsonb_set(e, '{url}', '"https://career.nornickel.ru/vacancies/"')
                      when 'https://rabota.lemanapro.ru/vacancies'
                        then jsonb_set(e, '{url}', '"https://rabota.lemanapro.ru/vacancies/moskva-i-oblast"')
                      else e
                    end order by ord), '[]'::jsonb)
            from jsonb_array_elements(connector_config->'endpoints')
                 with ordinality as t(e, ord)))
 where id = 'career'
   and jsonb_typeof(connector_config->'endpoints') = 'array';

-- В карточках стояло направление вместо работодателя: «Технический блок»
-- вместо Ростелекома, «IT и разработка продуктов» вместо Yadro, «Розничная
-- сеть» вместо Lamoda. Настройка давно исправлена (company_const), и код берёт
-- постоянное название ПОСЛЕ разбора полей — но эти строки записались раньше и
-- с тех пор не переписывались: обход до них не доходил. Чиним данные, чтобы не
-- ждать круга.
update public.jm_ext_vacancies set company = 'Ростелеком'
 where source_id = 'career' and url like 'https://job.rt.ru/%' and company <> 'Ростелеком';
update public.jm_ext_vacancies set company = 'Yadro'
 where source_id = 'career' and url like 'https://careers.yadro.com/%' and company <> 'Yadro';
update public.jm_ext_vacancies set company = 'Lamoda'
 where source_id = 'career' and url like 'https://job.lamoda.ru/%' and company <> 'Lamoda';

commit;
