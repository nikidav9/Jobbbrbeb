#!/bin/bash
# Синхронизирует scripts/career-sites.tsv с production-источником career_owner.
# Файл — единый master-list целей: сейчас 408 компаний. Еженедельная разведка
# на сервере (infra/career-discover-run.sh) находит и проверяет новые endpoints
# сама и складывает их в DISCOVERED вне репозитория и вне базы — этот скрипт их
# подхватывает и добавляет к списку из репозитория (репозиторий главнее).
# В runtime не скармливаем все страницы напрямую как основной источник: у
# большинства нет JobPosting, поэтому «полный каталог» показывал одну вакансию.
# Вместо этого берём проверенные endpoints из scripts/career-endpoints.json, а
# весь master-list сохраняем в catalog_pages для аудита/разведки.
#
# Почему endpoints лежат файлом, а не читаются из базы, как было раньше. Раньше
# их накапливали миграции 074–095 прямо в connector_config, и в репозитории их
# не было вовсе. Когда миграция 096 снесла таблицу, список исчез целиком:
# восстановить его удалось только проигрыванием тех миграций на пустой базе.
# Данные, которые живут в одной базе и больше нигде, теряются вместе с ней —
# это и есть цена того решения.
#
# Отдельно держим production-quarantine. Это не удаление компании из каталога:
# компания остаётся целью browser-discovery, но заведомо неработающий endpoint
# не делает весь обход partial и не поддерживает протухшие вакансии активными.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
LIST="$REPO/scripts/career-sites.tsv"
QUARANTINE="$REPO/scripts/career-runtime-quarantine.json"
ENDPOINTS="$REPO/scripts/career-endpoints.json"
SECRETS=${SECRETS:-/opt/jobtoo-secrets/env}
DISCOVERED=${DISCOVERED:-/opt/jobtoo-state/career-endpoints.discovered.json}

[ -s "$LIST" ] || { echo "нет $LIST" >&2; exit 1; }
[ -s "$QUARANTINE" ] || { echo "нет $QUARANTINE" >&2; exit 1; }
[ -s "$ENDPOINTS" ] || { echo "нет $ENDPOINTS" >&2; exit 1; }
[ -r "$SECRETS" ] || { echo "нет $SECRETS" >&2; exit 1; }

# Строим JSON только после полной проверки файла. Unicode-домены переводим в
# IDNA/punycode: серверная SSRF-проверка принимает только обычный ASCII host.
catalog_pages=$(python3 - "$LIST" <<'PY'
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

# Quarantine намеренно хранится рядом с master-list и проходит строгую
# валидацию до соединения с БД. Причина обязательна: иначе «временно выкинем
# endpoint» быстро превращается в вечную невидимую потерю работодателя.
quarantine=$(python3 - "$QUARANTINE" <<'PY'
import json
import sys
from urllib.parse import urlsplit

path = sys.argv[1]
with open(path, encoding='utf-8') as fh:
    rows = json.load(fh)
if not isinstance(rows, list) or not rows:
    raise SystemExit(f'{path}: ожидается непустой JSON-массив')
seen = set()
for idx, row in enumerate(rows, 1):
    if not isinstance(row, dict):
        raise SystemExit(f'{path}:{idx}: ожидается объект')
    url = str(row.get('url') or '').strip()
    company = str(row.get('company') or '').strip()
    reason = str(row.get('reason') or '').strip()
    observed = str(row.get('observed_at') or '').strip()
    u = urlsplit(url)
    if u.scheme.lower() != 'https' or not u.hostname or u.username or u.password:
        raise SystemExit(f'{path}:{idx}: нужен HTTPS URL без credentials: {url}')
    if not company or not reason or not observed:
        raise SystemExit(f'{path}:{idx}: нужны company, reason и observed_at')
    if url in seen:
        raise SystemExit(f'{path}:{idx}: повтор URL: {url}')
    seen.add(url)
print(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
print(f'career runtime quarantine: {len(rows)} endpoints', file=sys.stderr)
PY
)

# Endpoints проверяем так же строго, как quarantine, и по той же причине:
# отсюда сервер получает адреса, по которым пойдёт сам. Битая строка в файле
# не должна доезжать до базы.
endpoints=$(python3 - "$ENDPOINTS" <<'PY'
import json
import sys
from urllib.parse import urlsplit

path = sys.argv[1]
with open(path, encoding='utf-8') as fh:
    rows = json.load(fh)
if not isinstance(rows, list) or not rows:
    raise SystemExit(f'{path}: ожидается непустой JSON-массив')
seen = set()
for idx, row in enumerate(rows, 1):
    if not isinstance(row, dict):
        raise SystemExit(f'{path}:{idx}: ожидается объект')
    url = str(row.get('url') or '').strip()
    u = urlsplit(url)
    if u.scheme.lower() != 'https' or not u.hostname or u.username or u.password:
        raise SystemExit(f'{path}:{idx}: нужен HTTPS URL без credentials: {url}')
    mode = str(row.get('mode') or 'json')
    if mode not in ('json', 'html_links', 'embedded'):
        raise SystemExit(f'{path}:{idx}: неизвестный mode: {mode}')
    if url in seen:
        raise SystemExit(f'{path}:{idx}: повтор URL: {url}')
    seen.add(url)
print(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
print(f'career endpoints: {len(rows)} адресов', file=sys.stderr)
PY
)

# DISCOVERED пишет автомат (еженедельная разведка на сервере), а не человек:
# файл необязателен, и одна битая запись в нём не должна останавливать выкладку
# — такую запись просто пропускаем с сообщением в stderr. При совпадении URL
# репозиторий главнее: найденное разведкой его не переопределяет. Служебные
# поля company/discovered_at в connector_config не передаём.
merged_out=$(python3 - "$endpoints" "$DISCOVERED" <<'PY'
import json
import sys
from urllib.parse import urlsplit

repo_json, discovered_path = sys.argv[1], sys.argv[2]
repo_rows = json.loads(repo_json)

ALLOWED_MODES = ('json', 'html_links', 'embedded')
FIELDS = ('url', 'mode', 'map', 'paging', 'method', 'body')

def load_discovered(path):
    try:
        with open(path, encoding='utf-8') as fh:
            raw = fh.read()
    except FileNotFoundError:
        return []
    if not raw.strip():
        return []
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f'{path}: битый JSON, считаю пустым ({exc})', file=sys.stderr)
        return []
    if not isinstance(rows, list):
        print(f'{path}: ожидается JSON-массив, считаю пустым', file=sys.stderr)
        return []
    seen = {row['url'] for row in repo_rows}
    good = []
    for idx, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            print(f'{path}:{idx}: не объект, пропускаю', file=sys.stderr)
            continue
        url = str(row.get('url') or '').strip()
        u = urlsplit(url)
        if u.scheme.lower() != 'https' or not u.hostname or u.username or u.password:
            print(f'{path}:{idx}: не https-URL без credentials, пропускаю: {url}', file=sys.stderr)
            continue
        mode = str(row.get('mode') or 'json')
        if mode not in ALLOWED_MODES:
            print(f'{path}:{idx}: неизвестный mode {mode}, пропускаю: {url}', file=sys.stderr)
            continue
        if url in seen:
            # уже есть в репозитории (тот главнее) или повтор внутри файла
            continue
        seen.add(url)
        good.append({k: row[k] for k in FIELDS if k in row})
    return good

discovered_rows = load_discovered(discovered_path)
print(json.dumps(repo_rows + discovered_rows, ensure_ascii=False, separators=(',', ':')))
print(len(discovered_rows))
print(f'career discovered: {len(discovered_rows)} новых адресов добавлено к {len(repo_rows)} из репозитория', file=sys.stderr)
PY
)
endpoints=$(printf '%s\n' "$merged_out" | sed -n '1p')
# Сколько найденных разведкой endpoints вошло в объединённый список до
# применения production-quarantine (дубликаты URL с репозиторием уже отсеяны).
discovered_count=$(printf '%s\n' "$merged_out" | sed -n '2p')

set -a
. "$SECRETS"
set +a
cd "$REPO/infra"
q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

# Проверенные JSON/HTML endpoint'ы уже живут в source=career. Это результат
# ручной и browser-разведки. Перед публикацией убираем адреса, которые полный
# проход ИМЕННО с production-сервера подтвердил как 4xx/TLS/unsafe-DNS.
# Список не теряется: он записан в runtime_quarantine, а сама компания остаётся
# в catalog_pages и продолжает участвовать в browser-discovery.
q -v catalog_pages="$catalog_pages" -v quarantine="$quarantine" -v endpoints="$endpoints" \
  -v discovered_count="$discovered_count" <<'SQL'
create temp table jt_career_sync as
with raw as (
  select :'endpoints'::jsonb as endpoints
), expanded as (
  select e.value as endpoint, e.ordinality as ord
    from raw
    cross join lateral jsonb_array_elements(raw.endpoints) with ordinality as e(value, ordinality)
)
select coalesce(jsonb_agg(endpoint order by ord), '[]'::jsonb) as endpoints
  from expanded
 where not exists (
   select 1
     from jsonb_array_elements(:'quarantine'::jsonb) as q(value)
    where q.value->>'url' = expanded.endpoint->>'url'
 );

do $$
begin
  if coalesce((select jsonb_array_length(endpoints) from jt_career_sync), 0) = 0 then
    raise exception 'после production-quarantine не осталось карьерных endpoints';
  end if;
end
$$;

with desired as (
  select jsonb_build_object(
    'endpoints', endpoints,
    'catalog_pages', :'catalog_pages'::jsonb,
    'catalog_file', 'scripts/career-sites.tsv',
    'runtime_quarantine', :'quarantine'::jsonb,
    'discovered_count', :'discovered_count'::int
  ) as cfg
  from jt_career_sync
)
insert into public.jm_ext_sources (
  id, name, url, enabled, period_min, connector_kind, connector_config
)
select
  'career_owner',
  'Карьерные сайты — полный каталог',
  'https://jobtoo.ru/api/career.php?source=career_owner',
  true,
  360,
  'career',
  cfg
from desired
on conflict (id) do update
set name = excluded.name,
    url = excluded.url,
    enabled = true,
    period_min = excluded.period_min,
    connector_kind = excluded.connector_kind,
    connector_config = excluded.connector_config,
    last_run_at = case
      when public.jm_ext_sources.connector_config is distinct from excluded.connector_config then null
      else public.jm_ext_sources.last_run_at
    end,
    consecutive_failures = case
      when public.jm_ext_sources.connector_config is distinct from excluded.connector_config then 0
      else public.jm_ext_sources.consecutive_failures
    end;

-- Если единственный runtime-endpoint работодателя попал в quarantine, его
-- старые строки больше нельзя называть активными. Для компании с другим
-- здоровым endpoint ничего не выключаем.
with q as (
  select value as item
    from jsonb_array_elements(:'quarantine'::jsonb)
), healthy_company as (
  select distinct lower(trim(e.value->>'company_hint')) as company
    from jt_career_sync s
    cross join lateral jsonb_array_elements(s.endpoints) as e(value)
   where coalesce(e.value->>'company_hint', '') <> ''
), stale_company as (
  select distinct lower(trim(q.item->>'company')) as company
    from q
   where coalesce(q.item->>'company', '') <> ''
     and not exists (
       select 1 from healthy_company h
        where h.company = lower(trim(q.item->>'company'))
     )
)
update public.jm_ext_vacancies v
   set active = false
 where v.source_id = 'career_owner'
   and v.active = true
   and lower(trim(coalesce(v.company, ''))) in (select company from stale_company);

select 'career runtime: '
       || jsonb_array_length(endpoints)::text
       || ' healthy endpoints; quarantine: '
       || jsonb_array_length(:'quarantine'::jsonb)::text
  from jt_career_sync;
SQL
