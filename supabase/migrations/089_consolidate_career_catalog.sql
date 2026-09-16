-- Полный карьерный каталог должен показывать реальные вакансии, а не только
-- список 170 страниц. До этой миграции source=career_owner содержал сырые
-- карьерные URL, большинство без schema.org/JobPosting, поэтому в UI у него
-- оставалась одна вакансия. Проверенные JSON/HTML-коннекторы уже работали в
-- source=career и давали основной объём.
--
-- Переносим текущие активные строки под career_owner сразу, чтобы после deploy
-- пользователю не пришлось ждать нового полного обхода; legacy source=career
-- выключаем, иначе те же вакансии будут показаны дважды и в фильтре источников
-- останутся два почти одинаковых пункта.

begin;

-- У career_owner до этого могла лежать одна строка из raw JobPosting. Она не
-- должна конфликтовать по (source_id, external_id) при переносе рабочего фида.
delete from public.jm_ext_vacancies
 where source_id = 'career_owner';

update public.jm_ext_vacancies
   set source_id = 'career_owner'
 where source_id = 'career';

update public.jm_ext_sources
   set enabled = false,
       name = 'Карьерные страницы — legacy'
 where id = 'career';

update public.jm_ext_sources
   set enabled = true,
       name = 'Карьерные сайты — полный каталог',
       url = 'https://jobtoo.ru/api/career.php?source=career_owner',
       period_min = 360,
       environment = 'production',
       connector_kind = 'career',
       integration_mode = 'redirect',
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career_owner';

-- В фильтре компаний четыре варианта одного и того же работодателя
-- («ООО "Яндекс лавка"», «ООО Яндекс лавка», «Яндекс лавка»,
-- «Яндекс Лавка») отображались отдельными пунктами. Приводим их к названию,
-- которое уже используется приложением для этого работодателя.
update public.jm_ext_vacancies
   set company = 'Лавка'
 where regexp_replace(lower(coalesce(company, '')), '[^[:alnum:]]+', '', 'g')
       in ('лавка', 'яндекславка', 'оояндекславка');

commit;

notify pgrst, 'reload schema';
