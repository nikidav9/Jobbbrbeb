-- Переводим production-источник career_owner с первоначальных 62 компаний
-- на единый master-list scripts/career-sites.tsv (сейчас 163 компании / 169
-- карьерных разделов).
--
-- Сам список намеренно НЕ копируем сюда вторым огромным JSON: его синхронизирует
-- infra/sync-career-catalog.sh сразу после миграций. Так один и тот же перечень
-- используется разведкой Playwright и production-коннектором и не расходится.

begin;

update public.jm_ext_sources
   set name = 'Карьерные сайты — полный каталог',
       enabled = true,
       period_min = 360,
       environment = 'production',
       connector_kind = 'career',
       integration_mode = 'redirect',
       url = 'https://jobtoo.ru/api/career.php?source=career_owner',
       last_run_at = null,
       consecutive_failures = 0
 where id = 'career_owner';

commit;

notify pgrst, 'reload schema';
