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
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
OUT=${OUT:-/var/www/html/career-discovery.json}
LOG=${LOG:-/var/log/jt-career-discover.log}
STATUS=${STATUS:-/var/www/html/career-discovery-status.json}
LOCK=/run/jt-career-discover.lock
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

say "начинаю: образ $IMAGE"
state running "качаю образ $IMAGE"
docker pull -q "$IMAGE" >>"$LOG" 2>&1 || fail "не скачался образ"

mkdir -p "$(dirname "$MODULES")"
tmp="$OUT.tmp"
rm -f "$tmp"

# Пакет playwright ставим в каталог на хосте и переиспользуем между запусками:
# качать его каждый раз незачем. Браузеры лежат в самом образе.
state running "обход сайтов"
docker run --rm \
  --network host \
  -v "$REPO:/repo:ro" \
  -v "$(dirname "$MODULES"):/deps" \
  -v "$(dirname "$tmp"):/out" \
  -e DISCOVER_OUT="/out/$(basename "$tmp")" \
  -e DISCOVER_CONCURRENCY="${DISCOVER_CONCURRENCY:-3}" \
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
state done "$(wc -c <"$OUT") байт"
