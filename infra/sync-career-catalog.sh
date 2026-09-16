#!/bin/bash
# Синхронизирует scripts/career-sites.tsv с production-источником career_owner.
# Файл — единый master-list: сейчас 163 компании / 169 карьерных разделов.
# Повторный запуск безопасен; migrate.sh вызывает этот скрипт после миграций.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
LIST="$REPO/scripts/career-sites.tsv"
SECRETS=${SECRETS:-/opt/jobtoo-secrets/env}

[ -s "$LIST" ] || { echo "нет $LIST" >&2; exit 1; }
[ -r "$SECRETS" ] || { echo "нет $SECRETS" >&2; exit 1; }

# Строим JSON только после полной проверки файла. Unicode-домены переводим в
# IDNA/punycode: серверная SSRF-проверка принимает только обычный ASCII host.
pages=$(python3 - "$LIST" <<'PY'
import json
import sys
from urllib.parse import urlsplit, urlunsplit

path = sys.argv[1]
rows = []
companies = set()
with open(path, encoding='utf-8') as fh:
    for lineno, raw in enumerate(fh, 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) != 2:
            raise SystemExit(f'{path}:{lineno}: ожидаются название<TAB>URL')
        name, url = (p.strip() for p in parts)
        if not name or not url:
            raise SystemExit(f'{path}:{lineno}: пустое название или URL')
        u = urlsplit(url)
        if u.scheme.lower() != 'https' or not u.hostname or u.username or u.password:
            raise SystemExit(f'{path}:{lineno}: нужен HTTPS URL без credentials: {url}')
        host = u.hostname.encode('idna').decode('ascii')
        netloc = host if u.port is None else f'{host}:{u.port}'
        normalized = urlunsplit(('https', netloc, u.path or '/', u.query, ''))
        rows.append(normalized)
        companies.add(name.split(' · ', 1)[0])

if len(rows) < 160:
    raise SystemExit(f'каталог подозрительно мал: {len(rows)} адресов')
if len(rows) != len(set(rows)):
    raise SystemExit('в каталоге есть повторяющиеся URL')
print(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
print(f'career catalog: {len(companies)} компаний / {len(rows)} разделов', file=sys.stderr)
PY
)

set -a
. "$SECRETS"
set +a
cd "$REPO/infra"
q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

# last_run_at сбрасываем только когда список реально поменялся: иначе минутный
# migrate-loop заставлял бы карьерный источник бесконечно начинать заново.
q -v pages="$pages" <<'SQL'
insert into public.jm_ext_sources (
  id, name, url, enabled, period_min, environment,
  connector_kind, integration_mode, connector_config
) values (
  'career_owner',
  'Карьерные сайты — полный каталог',
  'https://jobtoo.ru/api/career.php?source=career_owner',
  true,
  360,
  'production',
  'career',
  'redirect',
  jsonb_build_object(
    'pages', :'pages'::jsonb,
    'catalog_file', 'scripts/career-sites.tsv'
  )
)
on conflict (id) do update
set name = excluded.name,
    url = excluded.url,
    enabled = true,
    period_min = excluded.period_min,
    environment = excluded.environment,
    connector_kind = excluded.connector_kind,
    integration_mode = excluded.integration_mode,
    connector_config = excluded.connector_config,
    last_run_at = case
      when public.jm_ext_sources.connector_config is distinct from excluded.connector_config then null
      else public.jm_ext_sources.last_run_at
    end,
    consecutive_failures = case
      when public.jm_ext_sources.connector_config is distinct from excluded.connector_config then 0
      else public.jm_ext_sources.consecutive_failures
    end;
SQL
