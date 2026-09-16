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
LOCK=/run/jt-career-discover.lock
# Версия та же, что закреплена в GitHub Actions: браузер в образе и пакет
# playwright обязаны совпадать, иначе Chromium не найдётся.
PW=${PW:-1.51.1}
IMAGE="mcr.microsoft.com/playwright:v${PW}-jammy"
MODULES=/opt/jobtoo-career-discover/node_modules

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

exec 9>"$LOCK"
flock -n 9 || { say "уже идёт, выхожу"; exit 0; }

command -v docker >/dev/null || { say "docker не установлен"; exit 1; }
[ -r "$REPO/scripts/career-discover.mjs" ] || { say "нет $REPO/scripts"; exit 1; }

# Образ Playwright весит около полутора гигабайт. На забитом диске выкачка
# оборвётся на середине и оставит мусор, поэтому проверяем заранее.
free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
if [ "${free_mb:-0}" -lt 4096 ]; then
  say "мало места на диске: ${free_mb:-0} МБ, нужно 4096 — пропускаю"
  exit 1
fi

say "начинаю: образ $IMAGE"
docker pull -q "$IMAGE" >>"$LOG" 2>&1 || { say "не скачался образ"; exit 1; }

mkdir -p "$(dirname "$MODULES")"
tmp="$OUT.tmp"
rm -f "$tmp"

# Пакет playwright ставим в каталог на хосте и переиспользуем между запусками:
# качать его каждый раз незачем. Браузеры лежат в самом образе.
docker run --rm \
  --network host \
  -v "$REPO:/repo:ro" \
  -v "$(dirname "$MODULES"):/deps" \
  -v "$(dirname "$tmp"):/out" \
  -e DISCOVER_OUT="/out/$(basename "$tmp")" \
  -e DISCOVER_CONCURRENCY="${DISCOVER_CONCURRENCY:-3}" \
  -e NODE_PATH=/deps/node_modules \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e HOME=/tmp \
  "$IMAGE" \
  bash -lc "
    set -e
    cd /deps
    [ -d node_modules/playwright ] || npm install --no-save --no-audit --no-fund playwright@${PW}
    cd /repo && node scripts/career-discover.mjs
  " >>"$LOG" 2>&1 || { say "разведка упала, подробности выше"; rm -f "$tmp"; exit 1; }

[ -s "$tmp" ] || { say "пустой результат"; rm -f "$tmp"; exit 1; }
# Готовый файл появляется одним движением: недочитанный JSON хуже старого.
mv -f "$tmp" "$OUT"
chmod 0644 "$OUT"
say "готово: $(wc -c <"$OUT") байт → $OUT"
