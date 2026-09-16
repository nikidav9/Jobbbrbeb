-- Yadro — сохранено из PR #123 при консолидации веток.
--
-- Историческое имя файла оставлено, потому что мигратор отслеживает полный
-- basename в jm_migrations. Старый Sber endpoint намеренно удалён из этой
-- миграции: актуальный production-safe источник Сбера подключается позже в
-- 094_sber_developers_direct.sql и должен оставаться единственным вариантом.
--
-- Yadro отдаёт список по vacancies (разведка смотрела results и получала ноль)
-- и адрес /vacancy/{slug}. Используем endpoint с siteId=career; он отличается
-- от ранее quarantined URL и потому отдельно проверяется runtime-smoke.

begin;

update public.jm_ext_sources s
   set connector_config = jsonb_set(
         s.connector_config,
         '{endpoints}',
         (s.connector_config->'endpoints') || (
           select coalesce(jsonb_agg(c.value order by c.ord), '[]'::jsonb)
             from jsonb_array_elements(jsonb_build_array(
               jsonb_build_object(
                 'url', 'https://careers.yadro.com/api/vacancies/?siteId=career',
                 'map', jsonb_build_object(
                   'list', 'vacancies',
                   'title', 'title',
                   'id', 'slug',
                   'address', 'city',
                   'description', 'description',
                   'schedule', 'empl',
                   'url_template', 'https://careers.yadro.com/vacancy/{slug}',
                   'company_const', 'Yadro'
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
