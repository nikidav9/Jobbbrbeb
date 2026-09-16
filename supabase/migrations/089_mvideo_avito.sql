-- Ещё два работодателя из списка владельца: М.Видео-Эльдорадо и Авито.
--
-- Оба читаются ссылками со страницы (mode: html_links). Проверено разбором
-- настоящей страницы: у М.Видео 14 вакансий и это линейный персонал —
-- «Продавец», «Кладовщик», «Водитель», — у Авито 57.
--
-- Адреса вакансий проверены строго, настоящий против выдуманного:
--   М.Видео  /vacancies/5e53b9ece064c00009f9fa52 → 200 с названием должности,
--            /vacancies/000000000000000000000000 → 500 без него;
--   Авито    /vacancies/prodazhi/20526/ → 200 с названием,
--            /vacancies/prodazhi/99999999/ → 404.
--
-- Правка точечная: дописываем два элемента в endpoints, а не переписываем
-- настройку целиком. Каждая перезапись всего JSON — шанс потерять то, что
-- добавила соседняя миграция.

begin;

update public.jm_ext_sources
   set connector_config = jsonb_set(
         connector_config,
         '{endpoints}',
         (connector_config->'endpoints') || jsonb_build_array(
           jsonb_build_object(
             'url', 'https://career.mvideoeldorado.ru/vacancies',
             'mode', 'html_links',
             'map', jsonb_build_object(
               'link_path', '/vacancies/',
               'company_const', 'М.Видео-Эльдорадо'
             )
           ),
           jsonb_build_object(
             'url', 'https://career.avito.com/vacancies/',
             'mode', 'html_links',
             'map', jsonb_build_object(
               'link_path', '/vacancies/',
               'company_const', 'Авито'
             )
           )
         ))
 where id = 'career'
   and jsonb_typeof(connector_config->'endpoints') = 'array'
   -- Повторный запуск миграции не должен задваивать источники.
   and not exists (
     select 1 from jsonb_array_elements(connector_config->'endpoints') e
     where e->>'url' = 'https://career.mvideoeldorado.ru/vacancies'
   );

commit;

notify pgrst, 'reload schema';
