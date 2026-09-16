-- Магнит. Владелец прислал рабочий адрес каталога и спросил, почему у нас
-- пусто, — и был прав: в списке целей у Магнита стоял голый корень
-- rabota.magnit.ru, а вакансии живут на /moskva/vacancies. Разведка честно
-- обошла корень и ничего не нашла, потому что там их и нет.
--
-- Браузер на правильном адресе показал, откуда страница берёт данные:
-- /api/v1/vacancy. Обычный запрос без скриптов его читает.
--
-- Город обязателен: без locality_id API отвечает 400 и прямо пишет, что нужен
-- либо город, либо рамка координат. Рамку на всю страну он не принимает
-- (right_longitude больше 180 — ошибка проверки, а на 180 отдаёт пустой
-- список). Поэтому перечисляем города списком в одном адресе: так он берёт
-- их все разом. Двенадцать городов — Москва, Санкт-Петербург, Екатеринбург, Новосибирск, Краснодар, Казань, Ростов-на-Дону, Самара, Уфа, Красноярск, Пермь, Волгоград — дают 4448 вакансий.
--
-- Это розница: «Директор магазина», «Водитель погрузчика», «Водитель-диспетчер»
-- — та самая аудитория, ради которой JobToo и делается.
--
-- Адрес вакансии оказался проще, чем на сайте: /vacancy/{id} работает БЕЗ города,
-- проверено — настоящий отдаёт 200 с названием должности, выдуманный 404.
--
-- Постраничная выдача сверена по идентификаторам: вторая сотня не повторяет
-- первую ни одной записью. per_page=100 API принимает, по умолчанию отдаёт 9.
--
-- В карантине Магнита нет.

begin;

update public.jm_ext_sources s
   set connector_config = jsonb_set(
         s.connector_config,
         '{endpoints}',
         (s.connector_config->'endpoints') || (
           select coalesce(jsonb_agg(c.value order by c.ord), '[]'::jsonb)
             from jsonb_array_elements(jsonb_build_array(
               jsonb_build_object(
                 'url', 'https://rabota.magnit.ru/api/v1/vacancy?overview=list&page=1&per_page=100&locality_id%5B%5D=3047&locality_id%5B%5D=3078&locality_id%5B%5D=2562&locality_id%5B%5D=1949&locality_id%5B%5D=506&locality_id%5B%5D=313&locality_id%5B%5D=2269&locality_id%5B%5D=2431&locality_id%5B%5D=20&locality_id%5B%5D=687&locality_id%5B%5D=2173&locality_id%5B%5D=1002',
                 'paging', jsonb_build_object('type', 'page', 'param', 'page', 'start', 1, 'limit', 100),
                 'map', jsonb_build_object(
                   'list', 'results',
                   'title', 'name',
                   'id', 'id',
                   'address', 'address',
                   'schedule', 'schedule_title',
                   'pay', 'salary_human',
                   'description', 'responsibilities',
                   'url_template', 'https://rabota.magnit.ru/vacancy/{id}',
                   'company_const', 'Магнит'
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
