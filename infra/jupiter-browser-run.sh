#!/usr/bin/env bash
# Браузерный воркер Jupiter (JUPITER_ENGINE=browser) на московском сервере.
#
# Служба jt-jupiter-browser (см. infra/bootstrap.sh) по умолчанию ВЫКЛЮЧЕНА:
# она стартует только при наличии флага /etc/jobtoo/jupiter-browser.enabled.
# Включать или нет — решает владелец.
#
# Браузер — в официальном образе Playwright с закреплённой версией, как у
# соседних служб (infra/browser-probe-run.sh, infra/career-discover-run.sh):
# на саму машину Chromium не ставим. Образ python-редакции: пакет playwright
# уже внутри, ставится только quickjs (jupiter/requirements.txt) — в
# постоянный каталог, чтобы не качать при каждом перезапуске.
# Секреты не лежат в коде: systemd читает их из EnvironmentFile
# (/opt/jobtoo-secrets/env, как у jt-jupiter), а сюда они попадают по имени
# (-e NAME без значения), в командной строке значений нет.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
PW=${PW:-1.63.0}
IMAGE="mcr.microsoft.com/playwright/python:v${PW}-jammy"
NAME=jt-jupiter-browser
STATE=${STATE:-/var/lib/jupiter-browser}
LOG=${LOG:-/var/log/jt-jupiter-browser.log}
FLAG=${FLAG:-/etc/jobtoo/jupiter-browser.enabled}

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

[ -f "$FLAG" ] || { say "нет флага $FLAG, воркер выключен"; exit 0; }
command -v docker >/dev/null || { say "docker не установлен"; exit 1; }
[ -r "$REPO/jupiter/run_worker.py" ] || { say "нет $REPO/jupiter/run_worker.py"; exit 1; }

mkdir -p "$STATE/site" "$STATE/data"
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  say "качаю образ $IMAGE"
  docker pull -q "$IMAGE" >>"$LOG" 2>&1 || { say "не скачался образ"; exit 1; }
}
# Хвост прошлого запуска, если systemd убил службу, а контейнер остался.
docker rm -f "$NAME" >/dev/null 2>&1 || true

say "запуск: образ $IMAGE"
# Потолок: боевая машина на 4 ГБ, рядом сайт и база. Памяти swap не даём.
exec docker run --rm --init --name "$NAME" \
  --memory 1500m --memory-swap 1500m --cpus 1 \
  -v "$REPO/jupiter:/app:ro" \
  -v "$STATE/site:/site" \
  -v "$STATE/data:/data" \
  -e PYTHONPATH=/site \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e HOME=/tmp \
  -e JUPITER_ENGINE=browser \
  -e JOBTOO_URL="${JOBTOO_URL:-https://jobtoo.ru}" \
  -e JUPITER_RECEIPTS=/data/receipts.json \
  -e JUPITER_HANDOFFS=/data/handoffs.json \
  -e JOBTOO_ADMIN_TOKEN -e ADMIN_API_TOKEN -e EXPO_PUBLIC_APP_SECRET \
  -e YANDEX_GPT_API_KEY -e YANDEX_GPT_FOLDER_ID \
  -e JUPITER_WORKER_ID="${JUPITER_WORKER_ID:-jupiter-browser-$(hostname)}" \
  "$IMAGE" \
  bash -c "pip install -q --disable-pip-version-check --target /site -r /app/requirements.txt && cd /app && exec python run_worker.py"
