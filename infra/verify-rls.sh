#!/bin/bash
# Проверяет, что базовая изоляция клиентских ролей, введённая миграцией 013,
# реально действует в живой БД. Скрипт намеренно проверяет состояние каталога
# PostgreSQL, а не только наличие SQL-файла в репозитории.
set -eu

REPO=${REPO:-/opt/jobtoo}
cd "$REPO/infra"
set -a; . /opt/jobtoo-secrets/env; set +a

q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

applied=$(q -c "select 1 from jm_migrations where name = '013_lock_down_rls.sql'" 2>/dev/null || true)
if [ "$applied" != "1" ]; then
  echo "RLS GUARD FAIL: 013_lock_down_rls.sql отсутствует в jm_migrations" >&2
  exit 1
fi

violations=$(q <<'SQL'
with required(table_name) as (
  values
    ('jm_users'), ('jm_vacancies'), ('jm_perm_vacancies'), ('jm_likes'),
    ('jm_perm_applications'), ('jm_chats'), ('jm_messages'), ('jm_ratings'),
    ('jm_notifications'), ('jm_complaints'), ('jm_bulletins'),
    ('jm_saved'), ('jm_perm_saved'), ('jm_vacancy_views'), ('jm_perm_vacancy_views'),
    ('jm_bulletin_views'), ('jm_web_push_subscriptions'), ('jm_worker_slots'),
    ('jm_support_messages'), ('jm_support_threads'), ('jm_support_knowledge'),
    -- Заведены позже миграции 013 и защиту включают сами. В стороже их
    -- не было: RLS на них стоял, но никто этого не проверял.
    ('jm_bot_messages'), ('jm_consents'), ('jm_ext_clicks'),
    ('jm_skill_results'), ('jm_jupiter_applications')
), state as (
  select r.table_name, c.oid, c.relrowsecurity
  from required r
  left join pg_class c on c.relname = r.table_name
  left join pg_namespace n on n.oid = c.relnamespace
  where c.oid is not null and n.nspname = 'public'
)
select table_name || ':' ||
       case
         when not relrowsecurity then 'rls_off'
         when has_table_privilege('anon', oid, 'SELECT')
           or has_table_privilege('anon', oid, 'INSERT')
           or has_table_privilege('anon', oid, 'UPDATE')
           or has_table_privilege('anon', oid, 'DELETE')
           or has_table_privilege('anon', oid, 'TRUNCATE')
           or has_table_privilege('anon', oid, 'REFERENCES')
           or has_table_privilege('anon', oid, 'TRIGGER') then 'anon_grant'
         when has_table_privilege('authenticated', oid, 'SELECT')
           or has_table_privilege('authenticated', oid, 'INSERT')
           or has_table_privilege('authenticated', oid, 'UPDATE')
           or has_table_privilege('authenticated', oid, 'DELETE')
           or has_table_privilege('authenticated', oid, 'TRUNCATE')
           or has_table_privilege('authenticated', oid, 'REFERENCES')
           or has_table_privilege('authenticated', oid, 'TRIGGER') then 'authenticated_grant'
         else 'unknown'
       end
from state
where not relrowsecurity
   or has_table_privilege('anon', oid, 'SELECT')
   or has_table_privilege('anon', oid, 'INSERT')
   or has_table_privilege('anon', oid, 'UPDATE')
   or has_table_privilege('anon', oid, 'DELETE')
   or has_table_privilege('anon', oid, 'TRUNCATE')
   or has_table_privilege('anon', oid, 'REFERENCES')
   or has_table_privilege('anon', oid, 'TRIGGER')
   or has_table_privilege('authenticated', oid, 'SELECT')
   or has_table_privilege('authenticated', oid, 'INSERT')
   or has_table_privilege('authenticated', oid, 'UPDATE')
   or has_table_privilege('authenticated', oid, 'DELETE')
   or has_table_privilege('authenticated', oid, 'TRUNCATE')
   or has_table_privilege('authenticated', oid, 'REFERENCES')
   or has_table_privilege('authenticated', oid, 'TRIGGER')
order by table_name;
SQL
)

if [ -n "$violations" ]; then
  echo "RLS GUARD FAIL: клиентские роли получили доступ к защищённым таблицам:" >&2
  echo "$violations" >&2
  exit 1
fi

echo "RLS guard OK: migration 013 applied; protected tables have RLS and no anon/authenticated grants"
