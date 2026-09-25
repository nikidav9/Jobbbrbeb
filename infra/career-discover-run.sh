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
# Недельный прогон (infra/bootstrap.sh, jt-career-discover) делает четыре вещи
# сверх самого обхода — раньше их не было, и разведка заново лезла к уже
# подключённым компаниям и находила «источники», которые сама же не проверяла:
#
#   1. Компании с уже активными вакансиями узнаём из базы и передаём разведке
#      как DISCOVER_SKIP_FILE — повторно их не трогаем.
#   2. Найденное с status=='готов' проверяем тем же кодом, что потом собирает
#      вакансии, — php-proxy/career_verify.php внутри контейнера php. Заодно
#      той же проверкой прогоняем все уже накопленные записи
#      discovered.json: источник, переставший отдавать вакансии, не должен
#      молча жить в каталоге годами.
#   3. Принятое (ok==true) сливаем в /opt/jobtoo-state/career-endpoints.discovered.json
#      и запускаем sync-career-catalog.sh, чтобы новые источники включились
#      сами, без ручного шага.
#   4. У каждой записи считаем fails — подряд идущие провалы перепроверки;
#      два подряд убирают запись из discovered.json, один — просто отметка.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
OUT=${OUT:-/var/www/html/career-discovery.json}
LOG=${LOG:-/var/log/jt-career-discover.log}
STATUS=${STATUS:-/var/www/html/career-discovery-status.json}
LOCK=/run/jt-career-discover.lock
# Кандидаты и ответ career_verify.php могут разрастись за 128 КБ — предел
# ядра на один аргумент командной строки (ARG_MAX). Поэтому между шагами их
# гоняем файлами, а не через переменные окружения командной строки.
candidates_file=$(mktemp)
verify_file=$(mktemp)
trap 'rm -f "$candidates_file" "$verify_file"' EXIT
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

# Контейнер может упасть уже дописав часть результата (например память
# кончилась на середине обхода). Раньше такой кусок просто удалялся вместе с
# ошибкой — тихо, без следа. Сохраняем его рядом как $OUT.partial: не
# перезаписываем прошлый годный $OUT, но и не теряем то, что успели обойти.
save_partial() {
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$OUT.partial"
        chmod 0644 "$OUT.partial"
        say "частичный результат сохранён: $OUT.partial"
    else
        # Пустой (или отсутствующий) $tmp — сохранять нечего. Заодно убираем
        # устаревший $OUT.partial от прошлого падения: раз этот прогон не
        # оставил даже частичного результата, старый кусок вводит в заблуждение.
        rm -f "$tmp" "$OUT.partial"
    fi
}

# Итоговый статус, богаче промежуточных «state»: числа нужны, чтобы судить о
# прогоне не заглядывая в лог. Персональных данных тут нет — только адреса
# работодателей и счётчики, поэтому файл открыт в /var/www/html как и
# career-discovery.json.
final_status() {
    python3 - "$STATUS" "$1" "$targets" "$ready" "$closed" "$accepted" "$rejected" \
        "$removed" "$live_companies" "$live_vacancies" <<'PY' || true
import json, os, sys
from datetime import datetime, timezone

status_path, message, targets, ready, closed, accepted, rejected, removed, live_companies, live_vacancies = sys.argv[1:11]
payload = {
    'state': 'done',
    'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'message': message,
    'targets': int(targets),
    'ready': int(ready),
    'closed': int(closed),
    'accepted': int(accepted),
    'rejected': int(rejected),
    'removed': int(removed),
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
  " >>"$LOG" 2>&1 || {
    save_partial
    msg="разведка упала, подробности в $LOG"
    [ -s "$OUT.partial" ] && msg="$msg; частичный результат сохранён в $OUT.partial"
    fail "$msg"
  }

[ -s "$tmp" ] || { rm -f "$tmp"; fail "пустой результат"; }
# Готовый файл появляется одним движением: недочитанный JSON хуже старого.
mv -f "$tmp" "$OUT"
chmod 0644 "$OUT"
# Успешный прогон обесценивает любой прежний частичный результат.
rm -f "$OUT.partial"
say "готово: $(wc -c <"$OUT") байт → $OUT"

# ── Разбор результата: сколько целей, сколько готово, сколько закрыто ──────
# Кандидатов пишем сразу в $candidates_file, а не в переменную: их может
# набраться больше 128 КБ (ARG_MAX), а дальше файл идёт аргументом, не текстом.
#
# В candidates идут не только новые находки этого обхода, но и все уже
# накопленные записи discovered.json — раз в неделю career_verify.php
# перепроверяет их заново тем же кодом, что и сбор: источник, переставший
# отдавать вакансии, не должен молча жить в каталоге годами.
{
  read -r targets
  read -r ready
  read -r closed
} < <(python3 - "$OUT" "$candidates_file" "$DISCOVERED" <<'PY'
import json, sys

ENDPOINT_FIELDS = ('url', 'mode', 'map', 'paging', 'method', 'body')

with open(sys.argv[1], encoding='utf-8') as fh:
    results = json.load(fh)

targets = len(results)
ready = sum(1 for r in results if isinstance(r, dict) and r.get('status') == 'готов')
closed = sum(1 for r in results if isinstance(r, dict) and r.get('status') == 'закрыт')

candidates = []
seen_keys = set()
for r in results:
    if not isinstance(r, dict) or r.get('status') != 'готов':
        continue
    cfg = r.get('connector_config') or {}
    for ep in (cfg.get('endpoints') or []):
        company = str(r.get('name', '')).split(' · ', 1)[0].strip()
        candidates.append({'company': company, 'endpoint': ep})
        seen_keys.add((company, ep.get('url')))

# Плюс все уже накопленные записи — перепроверяем их тем же заходом.
try:
    with open(sys.argv[3], encoding='utf-8') as fh:
        existing = json.load(fh)
    if not isinstance(existing, list):
        existing = []
except FileNotFoundError:
    existing = []
except (OSError, ValueError) as exc:
    print(f'{sys.argv[3]}: не удалось прочитать, считаю пустым ({exc})', file=sys.stderr)
    existing = []

for e in existing:
    if not isinstance(e, dict):
        continue
    key = (e.get('company'), e.get('url'))
    if key in seen_keys:
        continue
    seen_keys.add(key)
    endpoint = {k: e[k] for k in ENDPOINT_FIELDS if k in e}
    candidates.append({'company': e.get('company'), 'endpoint': endpoint})

with open(sys.argv[2], 'w', encoding='utf-8') as fh:
    json.dump(candidates, fh, ensure_ascii=False)

print(targets)
print(ready)
print(closed)
PY
) || fail "не разобрал результат разведки"

# ── Проверка найденного тем же кодом, что потом собирает вакансии ──────────
accepted=0
rejected=0
printf '[]' >"$verify_file"
if [ "$(cat "$candidates_file")" != "[]" ]; then
  (cd "$REPO/infra" && docker compose exec -T php test -f /var/www/api/career_verify.php) \
    || fail "career_verify.php не развёрнут в контейнере php"
  say "проверяю найденные endpoints: кандидатов $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1], encoding="utf-8"))))' "$candidates_file")"
  (cd "$REPO/infra" && docker compose exec -T php php /var/www/api/career_verify.php <"$candidates_file" >"$verify_file") \
    || fail "career_verify.php упал"
  say "ответ career_verify.php: $(cat "$verify_file")"
fi

# ── Слияние принятого в discovered.json ─────────────────────────────────────
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

{
  read -r accepted
  read -r rejected
  read -r removed
  read -r verify_guard
} < <(python3 - "$DISCOVERED" "$candidates_file" "$verify_file" <<'PY'
import json, os, shutil, sys
from datetime import datetime, timezone

discovered_path, candidates_path, verify_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(candidates_path, encoding='utf-8') as fh:
    candidates = json.load(fh)
with open(verify_path, encoding='utf-8') as fh:
    verify_rows = json.load(fh)

# ── career-discover-merge:begin ─────────────────────────────────────────────
def merge_discovered(existing, candidates, verify_rows, now_iso):
    """Слить результат проверки в discovered.json.

    candidates — [{'company': str, 'endpoint': {...}}], всё, что ушло на
    проверку career_verify.php за этот прогон: и новые находки разведки, и уже
    накопленные записи discovered.json (перепроверяем их заново каждую неделю,
    источник может перестать отдавать вакансии молча). verify_rows — ответ
    career_verify.php, по одной строке {'company','url','ok',...} на каждый
    candidates-элемент, сматченный по паре (company, url).

    ok==true — запись остаётся (или добавляется, если новая) с fails=0 и
    свежим verified_at. ok==false у уже известной записи — fails+1, а запись
    с fails>=2 подряд удаляется (гнилой источник не должен жить в каталоге
    годами); ok==false у новой находки — она просто не добавляется, как и
    раньше.

    Предохранитель: career_verify.php ходит внутри php-контейнера, и у него
    самого может пропасть сеть — тогда он честно ответит ok=false на всё, что
    ему прислали, и это будет выглядеть как повальный отказ источников, а не
    как их реальная смерть. Отличаем: если среди перепроверенных СТАРЫХ
    записей (были в existing) набралось ≥3 и НИ ОДНА не ok — считаем это
    сбоем проверки целиком, а не сбоем источников: fails не растут, старые
    записи остаются как были. Новые находки этого прогона предохранитель не
    трогает — они как отклонялись при ok=false, так и отклоняются.

    Возвращает (merged, guard_message, removed): guard_message — '' в обычном
    случае, иначе текст предохранителя для лога и статуса; removed — сколько
    записей реально удалено из-за fails>=2 (не считая случаев, когда
    предохранитель не дал засчитать провал).
    """
    existing_by_key = {(e.get('company'), e.get('url')): e
                        for e in existing if isinstance(e, dict)}
    candidate_endpoint_by_key = {(c['company'], c['endpoint'].get('url')): c['endpoint']
                                  for c in candidates}

    old_checked = [row for row in verify_rows
                   if (row.get('company'), row.get('url')) in existing_by_key]
    old_ok = sum(1 for row in old_checked if row.get('ok'))
    verify_failed = len(old_checked) >= 3 and old_ok == 0
    guard_message = (
        f'перепроверка не засчитана: {old_ok} из {len(old_checked)} ok'
        if verify_failed else ''
    )

    merged = []
    removed = 0
    seen_keys = set()
    for row in verify_rows:
        key = (row.get('company'), row.get('url'))
        seen_keys.add(key)
        prev = existing_by_key.get(key)
        if row.get('ok'):
            if prev is not None:
                entry = dict(prev)
            else:
                entry = dict(candidate_endpoint_by_key.get(key) or {})
                entry['company'] = key[0]
                entry['discovered_at'] = now_iso
            entry['fails'] = 0
            entry['verified_at'] = now_iso
            merged.append(entry)
        elif prev is not None:
            if verify_failed:
                # Сбой проверки целиком — запись остаётся как была.
                merged.append(dict(prev))
                continue
            fails = int(prev.get('fails') or 0) + 1
            if fails < 2:
                entry = dict(prev)
                entry['fails'] = fails
                merged.append(entry)
            else:
                removed += 1
            # fails >= 2: запись гнилая, удаляется
        # иначе — отклонённая новая находка, добавлять нечего

    # Записи, которых почему-то не было среди verify_rows (например, разведка
    # прервалась до отправки на проверку), оставляем как были — их не трогали.
    for key, e in existing_by_key.items():
        if key not in seen_keys:
            merged.append(e)
    return merged, guard_message, removed
# ── career-discover-merge:end ───────────────────────────────────────────────

try:
    with open(discovered_path, encoding='utf-8') as fh:
        existing = json.load(fh)
    if not isinstance(existing, list):
        existing = []
except FileNotFoundError:
    existing = []
except (OSError, ValueError) as exc:
    # ValueError покрывает json.JSONDecodeError и UnicodeDecodeError, OSError —
    # IsADirectoryError/PermissionError. Файл пишет автомат, порча не должна
    # ронять недельный прогон.
    print(f'{discovered_path}: не удалось прочитать, считаю пустым ({exc})', file=sys.stderr)
    existing = []

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
merged, guard_message, removed = merge_discovered(existing, candidates, verify_rows, now)
if guard_message:
    print(guard_message, file=sys.stderr)

os.makedirs(os.path.dirname(discovered_path), exist_ok=True)
if os.path.exists(discovered_path):
    shutil.copy2(discovered_path, discovered_path + '.bak')
tmp = discovered_path + '.tmp'
with open(tmp, 'w', encoding='utf-8') as fh:
    json.dump(merged, fh, ensure_ascii=False, separators=(',', ':'))
os.replace(tmp, discovered_path)

# accepted/rejected считают только НОВЫЕ находки этого обхода — записи,
# перепроверенные повторно (уже были в discovered.json), в этот счёт не
# идут: их судьба видна по числу записей до/после слияния.
existing_keys = {(e.get('company'), e.get('url')) for e in existing if isinstance(e, dict)}
new_rows = [r for r in verify_rows if (r.get('company'), r.get('url')) not in existing_keys]
print(sum(1 for r in new_rows if r.get('ok')))
print(sum(1 for r in new_rows if not r.get('ok')))
print(removed)
print(guard_message)
print(f'career discovered: было {len(existing)} записей, стало {len(merged)} '
      f'(перепроверено {len(verify_rows) - len(new_rows)})', file=sys.stderr)
PY
) || fail "не смог слить найденные endpoints"

say "проверка: принято $accepted, отклонено $rejected, удалено $removed"
[ -n "$verify_guard" ] && say "предохранитель: $verify_guard"

# ── Включаем найденное само: та же публикация, что и у ручного master-list ──
sync_ok=1
if [ "$accepted" -gt 0 ] || [ "$removed" -gt 0 ]; then
  say "accepted=$accepted removed=$removed, запускаю sync-career-catalog.sh"
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

message="targets=$targets ready=$ready closed=$closed accepted=$accepted rejected=$rejected removed=$removed"
if [ -n "$verify_guard" ]; then
  message="$message; $verify_guard"
fi
if [ "$sync_ok" -ne 1 ]; then
  message="$message; sync-career-catalog.sh упал, результат разведки сохранён"
fi

final_status "$message"
say "готово: $message"
