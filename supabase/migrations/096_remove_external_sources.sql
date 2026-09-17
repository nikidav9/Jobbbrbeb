-- Убираются все интеграции с внешними источниками вакансий. Решение владельца:
-- «Удалить всё, включая карьерные сайты» и «Удалить полностью: и код, и
-- данные» — не просто выключить, а снести и код, и структуру, и содержимое.
--
-- Код (php-proxy/headhunter.php, superjob.php, arbihunter.php, career.php,
-- career_feed.php, ingest.php, ext_health.php, partner_core.php,
-- partner_outbox.php, partner_webhook.php, partner_billing.php,
-- superjob_oauth*.php, safe_url.php и клиентская сторона) удалён тем же
-- коммитом. Эта миграция убирает то, что код оставляет за собой в базе:
-- таблицы и их RPC/триггерные функции. Раньше так же полностью снесли
-- «Работу в России» (миграция 073) — только там источник был один среди
-- многих ещё живых, а здесь уходит вся ветка целиком.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction,
-- то есть каждый оператор фиксируется сам по себе. Без обёртки падение
-- посередине оставило бы базу в наполовину убранном состоянии.
begin;

-- Триггерные функции — до таблиц: DROP TABLE снимает сам триггер, но не
-- привязанную к нему функцию.
drop function if exists public.jm_ext_vacancy_inherit_environment() cascade;
drop function if exists public.jm_ext_vacancies_canonical_company_trg() cascade;

-- RPC, которыми пользовался только удалённый код (extVacancyCount,
-- extCompanyOptions, jm_canonical_ext_company, партнёрская очередь).
drop function if exists public.jm_ext_vacancy_filter_count(jsonb);
drop function if exists public.jm_ext_company_options();
drop function if exists public.jm_canonical_ext_company(text);
drop function if exists public.jm_claim_partner_outbox(integer);
drop function if exists public.jm_claim_partner_inbox(text, text, text, text, jsonb);

-- Партнёрский шлюз заявок и биллинг (миграции 045, 047, 048, 067).
drop table if exists public.jm_partner_reconciliation_issues cascade;
drop table if exists public.jm_partner_billable_events cascade;
drop table if exists public.jm_partner_tariffs cascade;
drop table if exists public.jm_partner_report_runs cascade;
drop table if exists public.jm_partner_data_consents cascade;
drop table if exists public.jm_partner_costs cascade;
drop table if exists public.jm_partner_rating_facts cascade;
drop table if exists public.jm_partner_outbox cascade;
drop table if exists public.jm_partner_inbox cascade;
drop table if exists public.jm_partner_messages cascade;
drop table if exists public.jm_partner_conversations cascade;
drop table if exists public.jm_partner_applications cascade;

-- SuperJob OAuth (миграция 060).
drop table if exists public.jm_superjob_connections cascade;
drop table if exists public.jm_superjob_oauth_states cascade;

-- Сами источники и их вакансии (миграции 014, 031, 036).
drop table if exists public.jm_ext_clicks cascade;
drop table if exists public.jm_ext_vacancies cascade;
drop table if exists public.jm_ext_sources cascade;
drop table if exists public.jm_ext_ingest_runs cascade;
drop table if exists public.jm_ext_events cascade;

commit;

-- Гостевая аналитика (jm_guest_events) не трогается: колонка source_id
-- остаётся в схеме как история, но код больше её не заполняет, а
-- event_type 'external_click' и vacancy_kind 'external' — как исторические
-- значения в уже записанных строках. Таблица общая для всей гостевой
-- воронки, а не только внешних вакансий, поэтому не удаляется.

notify pgrst, 'reload schema';
