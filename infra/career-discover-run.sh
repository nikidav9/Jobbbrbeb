#!/usr/bin/env bash
# Разведка карьерных сайтов — С НАШЕГО МОСКОВСКОГО СЕРВЕРА.
#
# Зачем отдельно от GitHub Actions, где она уже есть. Потому что Actions стоит
# на американских адресах, а за вакансиями потом ходит эта машина, из Москвы, —
# и они видят разный интернет. Замерено в обе стороны:
#
#   * из Actions Альфа-Банк, Точка, НСПК и Positive Technologies отвечают
#     ERR_CERT_AUTHORITY_INVALID, а РЖД, ПЭК и «Вкусно — и точка» не
#     открываются вовсе. У cofinder, российского сервиса на российской
#     инфраструктуре, Альфа-Банк в каталоге есть;
#   * с этого сервера, наоборот, Пятёрочка, Ростелеком, Wildberries, МТС и
#     Lamoda отвечают 403, хотя из Actions читаются без вопросов.
#
# Никаких обходов: мы просто проверяем оттуда, откуда работаем.
#
# Браузер нужен потому, что вакансии почти везде рисует скрипт. Ставить
# Chromium прямо на сервер не хочется — тянет пол-иксов; берём официальный
# образ Playwright и запускаем разово, как импорт SuperJob.
#
# Недельный прогон (infra/bootstrap.sh, jt-career-discover) делает три вещи
# сверх самого обхода — раньше их не было, и разведка заново лезла к уже
# подключённым компаниям и находила «источники», которые сама же не проверяла:
#
#   1. Компании с уже активными вакансиями узнаём из базы и передаём разведке
#      как DISCOVER_SKIP_FILE — повторно их не трогаем.
#   2. Найденное с status=='готов' проверяем тем же кодом, что потом собирает
#      вакансии, — php-proxy/career_verify.php внутри контейнера php.
#   3. Принятое (ok==true) сливаем в /opt/jobtoo-state/career-endpoints.discovered.json
#      и запускаем sync-career-catalog.sh, чтобы новые источники включились
#      сами, без ручного шага.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
OUT=${OUT:-/var/www/html/career-discovery.json}
LOG=${LOG:-/var/log/jt-career-discover.log}
STATUS=${STATUS:-/var/www/html/career-discovery-status.json}
LOCK=/run/jt-career-discover.lock
SECRETS=${SECRETS:-/opt/jobtoo-secrets/env}
STATE_DIR=${STATE_DIR:-/opt/jobtoo-state}
DISCOVERED=${DISCOVERED:-$STATE_DIR/career-endpoints.discovered.json}
# Версия та же, что закреплена в GitHub Actions: браузер в образе и пакет
# playwright обязаны совпадать, иначе Chromium не найдётся.
PW=${PW:-1.51.1}
IMAGE="mcr.microsoft.com/playwright:v${PW}-jammy"
MODULES=/opt/jobtoo-career-discover/node_modules

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

# Отметка о ходе прогона рядом с результатом.
#
# Первый же запуск показал, зачем она нужна. Лог я завёл в /var/log — то есть
# там, куда со стороны не заглянешь. Прогон шёл, файла с результатом не было, и
# отличить «ещё работает» от «молча упал» было НЕЧЕМ. Ровно тот изъян, за
# который я в этот же день ругал источник career_owner: работа, чей отказ
# невидим снаружи.
#
# Поэтому состояние пишем рядом с результатом и отдаём тем же хостом.
state() {
    printf '{"state":"%s","at":"%s","message":%s}\n' \
        "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(printf '%s' "${2:-}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
        >"$STATUS.tmp" 2>/dev/null && mv -f "$STATUS.tmp" "$STATUS" || true
    chmod 0644 "$STATUS" 2>/dev/null || true
}
fail() { say "$1"; state error "$1"; exit 1; }

# Итоговый статус, богаче промежуточных «state»: числа нужны, чтобы судить о
# прогоне не заглядывая в лог. Персональных данных тут нет — только адреса
# работодателей и счётчики, поэтому файл открыт в /var/www/html как и
# career-discovery.json.
final_status() {
    python3 - "$STATUS" "$1" "$targets" "$ready" "$closed" "$accepted" "$rejected" \
        "$live_companies" "$live_vacancies" <<'PY' || true
import json, os, sys
from datetime import datetime, timezone

status_path, message, targets, ready, closed, accepted, rejected, live_companies, live_vacancies = sys.argv[1:10]
payload = {
    'state': 'done',
    'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'message': message,
    'targets': int(targets),
    'ready': int(ready),
    'closed': int(closed),
    'accepted': int(accepted),
    'rejected': int(rejected),
    'live_companies': int(live_companies),
    'live_vacancies': int(live_vacancies),
}
tmp = status_path + '.tmp'
with open(tmp, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, ensure_ascii=False)
os.replace(tmp, status_path)
os.chmod(status_path, 0o644)
PY
}

exec 9>"$LOCK"
flock -n 9 || { say "уже идёт, выхожу"; exit 0; }

command -v docker >/dev/null || fail "docker не установлен"
[ -r "$REPO/scripts/career-discover.mjs" ] || fail "нет $REPO/scripts"

# Образ Playwright весит около полутора гигабайт. На забитом диске выкачка
# оборвётся на середине и оставит мусор, поэтому проверяем заранее.
free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
if [ "${free_mb:-0}" -lt 4096 ]; then
  fail "мало места на диске: ${free_mb:-0} МБ, нужно 4096"
fi

[ -r "$SECRETS" ] || fail "нет $SECRETS"
set -a
. "$SECRETS"
set +a
q() { (cd "$REPO/infra" && docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"); }

# Компании с уже активными вакансиями разведке смотреть незачем: источник у
# них и так работает, а повторный заход — это лишний трафик на чужой сайт.
# Список кладём РЯДОМ со скриптом разведки, в /deps/run: тот же каталог
# career-discover.mjs копирует себе при запуске (см. bash ниже).
say "читаю компании с активными вакансиями"
run_dir="$(dirname "$MODULES")/run"
mkdir -p "$run_dir"
skip_file="$run_dir/discover-skip.txt"
q -tA -c "select distinct company from jm_ext_vacancies where active and company is not null" \
  >"$skip_file" 2>>"$LOG" || fail "не прочитал компании из базы"

say "начинаю: образ $IMAGE"
state running "качаю образ $IMAGE"
docker pull -q "$IMAGE" >>"$LOG" 2>&1 || fail "не скачался образ"

mkdir -p "$(dirname "$MODULES")"
tmp="$OUT.tmp"
rm -f "$tmp"

# Пакет playwright ставим в каталог на хосте и переиспользуем между запусками:
# качать его каждый раз незачем. Браузеры лежат в самом образе.
#
# Потолок ресурсов — контейнер идёт раз в неделю на боевой машине рядом с
# остальными службами, свалить их себе не должен.
state running "обход сайтов"
docker run --rm \
  --network host \
  --memory 1g --cpus 1 \
  -v "$REPO:/repo:ro" \
  -v "$(dirname "$MODULES"):/deps" \
  -v "$(dirname "$tmp"):/out" \
  -e DISCOVER_OUT="/out/$(basename "$tmp")" \
  -e DISCOVER_CONCURRENCY="${DISCOVER_CONCURRENCY:-2}" \
  -e DISCOVER_SKIP_FILE=/deps/run/discover-skip.txt \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e HOME=/tmp \
  "$IMAGE" \
  bash -lc "
    set -e
    cd /deps
    [ -d node_modules/playwright ] || npm install --no-save --no-audit --no-fund playwright@${PW}
    # Скрипт кладём РЯДОМ с node_modules, а не запускаем из /repo. Причина в
    # том, как ES-модули ищут пакеты: по имени 'playwright' Node идёт вверх по
    # node_modules от файла, который делает import, и NODE_PATH при этом НЕ
    # смотрит вовсе. Первая версия полагалась на NODE_PATH — и прогон умирал
    # на ERR_MODULE_NOT_FOUND, ничего не написав.
    #
    # Список сайтов тоже копируем: career-discover.mjs ищет career-sites.tsv
    # рядом с собой (import.meta.url), а не по текущему каталогу.
    mkdir -p /deps/run
    cp /repo/scripts/career-discover.mjs /repo/scripts/career-discover-lib.mjs \
       /repo/scripts/career-sites.tsv /deps/run/
    cd /deps/run && node career-discover.mjs
  " >>"$LOG" 2>&1 || { rm -f "$tmp"; fail "разведка упала, подробности в $LOG"; }

[ -s "$tmp" ] || { rm -f "$tmp"; fail "пустой результат"; }
# Готовый файл появляется одним движением: недочитанный JSON хуже старого.
mv -f "$tmp" "$OUT"
chmod 0644 "$OUT"
say "готово: $(wc -c <"$OUT") байт → $OUT"

# ── Разбор результата: сколько целей, сколько готово, сколько закрыто ──────
{
  read -r targets
  read -r ready
  read -r closed
  read -r candidates
} < <(python3 - "$OUT" <<'PY'
import json, sys

with open(sys.argv[1], encoding='utf-8') as fh:
    results = json.load(fh)

targets = len(results)
ready = sum(1 for r in results if isinstance(r, dict) and r.get('status') == 'готов')
closed = sum(1 for r in results if isinstance(r, dict) and r.get('status') == 'закрыт')

candidates = []
for r in results:
    if not isinstance(r, dict) or r.get('status') != 'готов':
        continue
    cfg = r.get('connector_config') or {}
    for ep in (cfg.get('endpoints') or []):
        candidates.append({'company': str(r.get('name', '')).split(' · ', 1)[0].strip(), 'endpoint': ep})

print(targets)
print(ready)
print(closed)
print(json.dumps(candidates, ensure_ascii=False))
PY
) || fail "не разобрал результат разведки"

# ── Проверка найденного тем же кодом, что потом собирает вакансии ──────────
accepted=0
rejected=0
verify_out='[]'
if [ "$candidates" != "[]" ]; then
  (cd "$REPO/infra" && docker compose exec -T php test -f /var/www/api/career_verify.php) \
    || fail "career_verify.php не развёрнут в контейнере php"
  say "проверяю найденные endpoints: кандидатов $(printf '%s' "$candidates" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
  verify_out=$(cd "$REPO/infra" && printf '%s' "$candidates" | docker compose exec -T php php /var/www/api/career_verify.php) \
    || fail "career_verify.php упал"
fi

# ── Слияние принятого в discovered.json ─────────────────────────────────────
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

{
  read -r accepted
  read -r rejected
} < <(python3 - "$DISCOVERED" "$candidates" "$verify_out" <<'PY'
import json, os, shutil, sys
from datetime import datetime, timezone

discovered_path, candidates_raw, verify_raw = sys.argv[1], sys.argv[2], sys.argv[3]
candidates = json.loads(candidates_raw)
verify_rows = json.loads(verify_raw)

# ── career-discover-merge:begin ─────────────────────────────────────────────
def merge_discovered(existing, accepted_rows, now_iso):
    """Слить принятые endpoints в discovered.json.

    accepted_rows — [{'company': str, 'endpoint': {...}}], уже отфильтрованные
    проверкой career_verify.php (ok==true). Компания, у которой в этом прогоне
    появился принятый endpoint, целиком заменяет свои прежние записи; записи
    остальных компаний остаются как были.
    """
    accepted_companies = {row['company'] for row in accepted_rows}
    kept = [e for e in existing
            if isinstance(e, dict) and e.get('company') not in accepted_companies]
    fresh = []
    for row in accepted_rows:
        entry = dict(row['endpoint'])
        entry['company'] = row['company']
        entry['discovered_at'] = now_iso
        fresh.append(entry)
    return kept + fresh
# ── career-discover-merge:end ───────────────────────────────────────────────

accepted_urls = {(r.get('company'), r.get('url')) for r in verify_rows if r.get('ok')}
accepted_rows = [c for c in candidates if (c['company'], c['endpoint'].get('url')) in accepted_urls]

try:
    with open(discovered_path, encoding='utf-8') as fh:
        existing = json.load(fh)
    if not isinstance(existing, list):
        existing = []
except (FileNotFoundError, json.JSONDecodeError):
    existing = []

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
merged = merge_discovered(existing, accepted_rows, now)

os.makedirs(os.path.dirname(discovered_path), exist_ok=True)
if os.path.exists(discovered_path):
    shutil.copy2(discovered_path, discovered_path + '.bak')
tmp = discovered_path + '.tmp'
with open(tmp, 'w', encoding='utf-8') as fh:
    json.dump(merged, fh, ensure_ascii=False, separators=(',', ':'))
os.replace(tmp, discovered_path)

print(len(accepted_rows))
print(len(candidates) - len(accepted_rows))
PY
) || fail "не смог слить найденные endpoints"

say "проверка: принято $accepted, отклонено $rejected"

# ── Включаем найденное само: та же публикация, что и у ручного master-list ──
sync_ok=1
if [ "$accepted" -gt 0 ]; then
  say "accepted=$accepted, запускаю sync-career-catalog.sh"
  if ! bash "$REPO/infra/sync-career-catalog.sh" >>"$LOG" 2>&1; then
    sync_ok=0
    say "sync-career-catalog.sh упал, результат разведки сохранён — смотри лог"
  fi
fi

# Числа для отчёта — берём уже после возможной синхронизации, они же уходят в
# публичный career-discovery-status.json. Не критично для успеха прогона:
# при сбое запроса просто останутся нулями.
live_companies=0
live_vacancies=0
live_line=$(q -tA -F'|' -c "select count(distinct company), count(*) from jm_ext_vacancies where active" 2>>"$LOG") \
  && live_companies=$(printf '%s' "$live_line" | cut -d'|' -f1) \
  && live_vacancies=$(printf '%s' "$live_line" | cut -d'|' -f2) || true

message="targets=$targets ready=$ready closed=$closed accepted=$accepted rejected=$rejected"
if [ "$sync_ok" -ne 1 ]; then
  message="$message; sync-career-catalog.sh упал, результат разведки сохранён"
fi

final_status "$message"
say "готово: $message"
