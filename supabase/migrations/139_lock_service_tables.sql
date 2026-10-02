-- Четыре служебные таблицы остались открыты роли anon: RLS выключен
-- (043, 052, 053 делали `disable row level security`), а права Supabase по
-- умолчанию дают anon чтение, запись и удаление. На бою снаружи их не
-- достать (проверено 01.10.2026: /rest/v1 отвечает 401), но любая база,
-- поднятая из миграций с нуля, получала их открытыми. Хуже всех
-- jm_migrations: удалив из неё строки, можно заставить migrate.sh заново
-- накатить старые миграции — 096 удаляет jm_ext_vacancies.
--
-- Ходит в них только прокси под сервисным ключом и psql владельца — оба
-- RLS не замечают, поэтому закрываем так же, как остальные (см. 013).

alter table if exists jm_migrations enable row level security;
revoke all on jm_migrations from anon, authenticated;

alter table jm_app_opens enable row level security;
revoke all on jm_app_opens from anon, authenticated;

alter table jm_survey_responses enable row level security;
revoke all on jm_survey_responses from anon, authenticated;

alter table jm_survey_sends enable row level security;
revoke all on jm_survey_sends from anon, authenticated;
