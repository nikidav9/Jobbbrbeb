#!/usr/bin/env bash
# Разовый замер браузером (scripts/browser-probe.mjs) — с московского сервера.
#
# Решение владельца 27.09.2026: прежде чем пускать Chromium в Jupiter,
# измерить, что он даст. Берём сайты, на которых ежедневная разведка
# (/var/www/html/jupiter-recon.json) упёрлась в классы spa и captcha, и
# смотрим их настоящим браузером: видна ли анкета и какая в ней капча.
#
# Только чтение: ничего не вводится и не отправляется, капча не решается.
# Браузер — в официальном образе Playwright, как у недельной разведки
# (infra/career-discover-run.sh): на саму машину Chromium не ставим.
# Итог — /jupiter-browser-probe.json, ход — /jupiter-browser-probe-status.json;
# в обоих только адреса работодателей и счётчики, ничего о людях.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
RECON=${RECON:-/var/www/html/jupiter-recon.json}
OUT=${OUT:-/var/www/html/jupiter-browser-probe.json}
STATUS=${STATUS:-/var/www/html/jupiter-browser-probe-status.json}
LOG=${LOG:-/var/log/jt-browser-probe.log}
LOCK=/run/jt-browser-probe.lock
# Та же версия, что у недельной разведки: образ уже скачан, пакет уже стоит.
PW=${PW:-1.51.1}
IMAGE="mcr.microsoft.com/playwright:v${PW}-jammy"
DEPS=/opt/jobtoo-career-discover

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }
state() {
  printf '{"state":"%s","at":"%s","message":%s}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(printf '%s' "${2:-}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    >"$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS" && chmod 0644 "$STATUS" || true
}
fail() { say "$1"; state error "$1"; exit 1; }

exec 9>"$LOCK"
flock -n 9 || { say "уже идёт, выхожу"; exit 0; }

command -v docker >/dev/null || fail "docker не установлен"
[ -r "$REPO/scripts/browser-probe.mjs" ] || fail "нет $REPO/scripts/browser-probe.mjs"
[ -s "$RECON" ] || fail "нет итога разведки $RECON"
free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
[ "${free_mb:-0}" -ge 4096 ] || fail "мало места на диске: ${free_mb:-0} МБ, нужно 4096"

say "начинаю: образ $IMAGE"
state running "качаю образ $IMAGE"
docker pull -q "$IMAGE" >>"$LOG" 2>&1 || fail "не скачался образ"

mkdir -p "$DEPS/probe"
cp "$REPO/scripts/browser-probe.mjs" "$DEPS/probe/"
cp "$RECON" "$DEPS/probe/recon.json"
tmp="$DEPS/probe/out.json"
rm -f "$tmp" "$tmp.partial"

state running "обход сайтов"
# Потолок ресурсов: боевая машина, рядом живые службы.
docker run --rm \
  --memory 1g --cpus 1 \
  -v "$DEPS:/deps" \
  -e PROBE_RECON=/deps/probe/recon.json \
  -e PROBE_OUT=/deps/probe/out.json \
  -e PROBE_CONCURRENCY="${PROBE_CONCURRENCY:-3}" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e HOME=/tmp \
  "$IMAGE" \
  bash -lc "
    set -e
    cd /deps
    [ -d node_modules/playwright ] || npm install --no-save --no-audit --no-fund playwright@${PW}
    # Скрипт — рядом с node_modules: ES-модуль ищет пакет вверх от себя.
    cp /deps/probe/browser-probe.mjs /deps/browser-probe.mjs
    node /deps/browser-probe.mjs
  " >>"$LOG" 2>&1 || {
    [ -s "$tmp.partial" ] && cp -f "$tmp.partial" "$OUT.partial" && chmod 0644 "$OUT.partial"
    fail "замер упал, подробности в $LOG"
  }

[ -s "$tmp" ] || fail "пустой результат"
mv -f "$tmp" "$OUT"
chmod 0644 "$OUT"
rm -f "$OUT.partial"
summary=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["summary"], ensure_ascii=False))' "$OUT")
say "готово: $summary"
state done "$summary"
