#!/usr/bin/env bash
# Браузерная разведка анкет отклика с московского адреса — раз в сутки,
# после HTTP-разведки (infra/recon-run.sh, таймер jt-recon).
#
# Зачем: HTTP-движок упирается в SPA-анкеты и кнопки «Откликнуться» на JS
# (классы spa, captcha, form_unmapped, no_vacancy) — такие сайты никогда не
# становились live_ready, и воркер парковал их с SITE_NOT_VERIFIED. Здесь
# jupiter/recon_browser.py проходит ровно эти разделы Chromium'ом; его
# dry_run_ok site_compat.live_ready читает из /jupiter-recon-browser.json
# наравне с HTTP-итогом (тот же срок свежести, JUPITER_RECON_MAX_AGE_DAYS).
#
# Только чтение: JupiterAgent(dry_run=True), движок read_only=True — браузер
# обрывает любой не-GET запрос, заявки не уходят. Кандидат синтетический.
# CAPTCHA не решается и никуда не отдаётся: такой раздел остаётся captcha.
# Подпись честная, как у боевого браузерного движка (Chrome + « JobToo/1.0
# (+https://jobtoo.ru; support@jobtoo.ru)»), своей здесь не ставим.
# Один браузер: боевая машина на 4 ГБ.
#
# Окружение — venv браузерного воркера (infra/jupiter-browser-run.sh):
# /opt/jupiter-browser/venv и Chromium из /opt/jupiter-browser/ms-playwright.
# Нет venv — ставим его тем же `jupiter-browser-run.sh setup` (идемпотентно).
# Сам обход идёт не от root, а от nobody: браузер открывает чужие сайты.
# В итоге только адреса работодателей и устройство анкет — ничего о людях.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
BASE=${BASE:-/opt/jupiter-browser}
VENV="$BASE/venv"
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$BASE/ms-playwright}
WORK=${WORK:-/var/lib/jt-recon-browser}
HTTP_RECON=${HTTP_RECON:-/var/www/html/jupiter-recon.json}
OUT=${OUT:-/var/www/html/jupiter-recon-browser.json}
LOG=${LOG:-/var/log/jt-recon-browser.log}
LOCK=${LOCK:-/run/jt-recon-browser.lock}
MAX_MINUTES=${MAX_MINUTES:-150}
# Сколько ждать, если HTTP-разведка ещё идёт (её предел — 5 часов).
WAIT_HTTP_MINUTES=${WAIT_HTTP_MINUTES:-240}

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

exec 9>"$LOCK"
flock -n 9 || { say "уже идёт, выхожу"; exit 0; }

[ -r "$REPO/jupiter/recon_browser.py" ] || { say "нет $REPO/jupiter/recon_browser.py"; exit 1; }

# Сначала HTTP: браузер берёт только то, что тот не прошёл.
waited=0
while systemctl is-active --quiet jt-recon.service 2>/dev/null; do
  if [ "$waited" -ge "$WAIT_HTTP_MINUTES" ]; then
    say "HTTP-разведка идёт дольше $WAIT_HTTP_MINUTES мин, пропускаю день"
    exit 0
  fi
  sleep 300
  waited=$((waited + 5))
done
[ -s "$HTTP_RECON" ] || { say "нет итога HTTP-разведки $HTTP_RECON"; exit 0; }

if [ ! -x "$VENV/bin/python" ]; then
  say "нет $VENV — ставлю окружение браузерного воркера"
  bash "$REPO/infra/jupiter-browser-run.sh" setup >>"$LOG" 2>&1 || { say "setup не прошёл"; exit 1; }
fi

mkdir -p "$WORK"
cp -f "$HTTP_RECON" "$WORK/http.json"
# Вчерашний итог — чтобы сперва подтвердить прежние dry_run_ok.
if [ -s "$OUT" ]; then cp -f "$OUT" "$WORK/browser.json"; fi
rm -f "$WORK"/browser.json.*.tmp
chown -R nobody:nogroup "$WORK"

say "начинаю: срок $MAX_MINUTES мин"
# Внешний предел — срок обхода плюс запас на начатый сайт.
if (cd "$REPO/jupiter" && timeout "$((MAX_MINUTES + 15))m" \
      setpriv --reuid=nobody --regid=nogroup --clear-groups \
      env HOME="$WORK" PYTHONDONTWRITEBYTECODE=1 PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" \
      "$VENV/bin/python" recon_browser.py --from-http "$WORK/http.json" \
        --out "$WORK/browser.json" --workers 1 --max-minutes "$MAX_MINUTES") >>"$LOG" 2>&1
then
  [ -s "$WORK/browser.json" ] || { say "пустой результат"; exit 1; }
  # Атомарно: копия рядом с итогом, затем rename в пределах одного каталога.
  tmp=$(mktemp "$OUT.XXXXXX")
  cp -f "$WORK/browser.json" "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$OUT"
  say "ok"
else
  say "failed"
  exit 1
fi
