#!/usr/bin/env bash
# Браузерный воркер Jupiter (JUPITER_ENGINE=browser) на московском сервере.
#
# Включается из репозитория: есть файл infra/jupiter-browser.enabled —
# bootstrap ставит флаг /etc/jobtoo/jupiter-browser.enabled и запускает
# службу jt-jupiter-browser; файла нет — флаг снимается, служба стоит.
#
# Два режима, оба зовёт юнит (см. infra/bootstrap.sh):
#   setup — от root (ExecStartPre=+): Playwright в отдельный venv, не в
#           системный python, и Chromium с системными библиотеками
#           (playwright install --with-deps). Идемпотентно: повтор только при
#           смене версии Playwright или jupiter/requirements.txt.
#   run   — от временного пользователя (DynamicUser): сам воркер.
# Секреты не лежат в коде: systemd читает их из EnvironmentFile
# (/opt/jobtoo-secrets/env, как у jt-jupiter, и /etc/jobtoo/yandex-gpt.env).
# Пишем в stdout: systemd складывает его в /var/log/jt-jupiter-browser.log.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
PW=${PW:-1.63.0}
BASE=${BASE:-/opt/jupiter-browser}
VENV="$BASE/venv"
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$BASE/ms-playwright}
FLAG=${FLAG:-/etc/jobtoo/jupiter-browser.enabled}
REQ="$REPO/jupiter/requirements.txt"

say() { printf '%s %s\n' "$(date -Is)" "$*"; }

setup() {
  local want mark="$BASE/.installed"
  want="playwright=$PW req=$(sha256sum "$REQ" | cut -d' ' -f1)"
  if [ "$(cat "$mark" 2>/dev/null || true)" = "$want" ] && [ -x "$VENV/bin/python" ]; then
    return 0
  fi
  say "установка: $want"
  mkdir -p "$BASE"
  # Без пакета python3-venv (Debian/Ubuntu) venv создаётся без pip — тогда
  # ставим пакет и создаём заново.
  if [ ! -x "$VENV/bin/pip" ]; then
    rm -rf "$VENV"
    python3 -m venv "$VENV" 2>/dev/null || {
      DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv
      rm -rf "$VENV"
      python3 -m venv "$VENV"
    }
  fi
  "$VENV/bin/pip" install -q --disable-pip-version-check "playwright==$PW" -r "$REQ"
  "$VENV/bin/python" -m playwright install --with-deps chromium
  # Воркер идёт от временного пользователя: ему нужно только чтение.
  chmod -R a+rX "$BASE"
  echo "$want" > "$mark"
  say "установлено: $want"
}

case "${1:-run}" in
  setup)
    # Setup зовут и служба воркера, и браузерная разведка (recon-browser-run.sh):
    # два pip в один venv разом не пускаем.
    mkdir -p "$BASE"
    exec 8>"$BASE/.setup.lock"
    flock 8
    setup
    ;;
  run)
    [ -f "$FLAG" ] || { say "нет флага $FLAG, воркер выключен"; exit 0; }
    [ -x "$VENV/bin/python" ] || { say "нет $VENV — не прошёл setup"; exit 1; }
    cd "$REPO/jupiter"
    say "запуск: playwright $PW, воркер ${JUPITER_WORKER_ID:-?}"
    exec "$VENV/bin/python" run_worker.py
    ;;
  *)
    echo "использование: $0 [setup|run]" >&2
    exit 2
    ;;
esac
