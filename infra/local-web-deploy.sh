#!/usr/bin/env bash
# Локальная сборка web без GitHub Actions.
#
# Сервер уже получает main через свой git-pull таймер. После появления нового
# commit этот скрипт собирает Expo прямо на московской машине в одноразовом
# Node-контейнере и атомарно переключает /var/www/jobtoo на готовый каталог.
# Старый сайт остаётся на месте при любой ошибке установки/сборки.
set -Eeuo pipefail

REPO=${REPO:-/opt/jobtoo}
SECRETS=${SECRETS:-/opt/jobtoo-secrets/env}
STATE=/var/lib/jt-web-local.sha
LOCK=/run/jt-local-web-deploy.lock
LOG=/var/log/jt-local-web-deploy.log
WEB_RELEASES=/var/www/jobtoo-releases

exec 8>"$LOCK"
flock -n 8 || exit 0

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$LOG"; }

on_error() {
  rc=$?
  trap - ERR
  log "FAIL ${HEAD:-unknown}: unexpected error rc=$rc"
  exit "$rc"
}
trap on_error ERR

HEAD=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)
[ -n "$HEAD" ] || { log "SKIP: git HEAD unavailable"; exit 0; }

# Уже развернули этот исходник — ничего тяжёлого не делаем.
if [ "$HEAD" = "$(cat "$STATE" 2>/dev/null || true)" ] && [ -s /var/www/jobtoo/index.html ]; then
  exit 0
fi

command -v docker >/dev/null 2>&1 || { log "FAIL $HEAD: docker unavailable"; exit 1; }
systemctl is-active --quiet docker || { log "FAIL $HEAD: docker inactive"; exit 1; }
[ -r "$SECRETS" ] || { log "FAIL $HEAD: secrets unavailable"; exit 1; }

# Git pull и web-сборка работают отдельным лёгким таймером. Поэтому новые
# SQL-миграции должны догонять production и здесь, а не ждать полного
# bootstrap. Накатыватель идемпотентен и повторный запуск безопасен.
if [ -x "$REPO/infra/migrate.sh" ]; then
  if bash "$REPO/infra/migrate.sh"; then
    log "MIGRATE $HEAD: ok"
  else
    log "MIGRATE_FAIL $HEAD: see /var/log/jt-apply.log"
    exit 1
  fi
else
  log "MIGRATE_FAIL $HEAD: migrator unavailable"
  exit 1
fi

# PHP-прокси должен ехать тем же лёгким deploy-циклом, что и web. Раньше
# git checkout обновлялся, миграции применялись, но /opt/jobtoo-proxy оставался
# на старом коде до редкого полного bootstrap — поэтому новые API-файлы давали
# 404 несмотря на свежий HEAD.
PROXY=/opt/jobtoo-proxy
mkdir -p "$PROXY"
if ! cp -f "$REPO"/php-proxy/*.php "$PROXY"/; then
  log "FAIL $HEAD: php-proxy copy"
  exit 1
fi

# Push-токены в jm_users храним зашифрованными. Ключ живёт только рядом с
# серверным PHP и не входит ни в git, ни в клиентскую сборку.
if [ ! -s "$PROXY/push_token_key.php" ]; then
  PUSH_TOKEN_KEY=$(openssl rand -base64 32 | tr -d '\n')
  printf "<?php return '%s';\n" "$PUSH_TOKEN_KEY" > "$PROXY/push_token_key.php"
  chmod 640 "$PROXY/push_token_key.php"
  chown root:www-data "$PROXY/push_token_key.php" 2>/dev/null || true
fi
log "PHP $HEAD: proxy refreshed"

# Одноразовый Web Push probe больше не нужен. Удаляем его и с уже
# развёрнутых серверов; команда безопасна при повторных запусках.
rm -f "$PROXY/test-webpush-once.php"

# Берём публичный ключ карт из уже работающей сборки, если он ещё не записан
# в серверные secrets. Ключ всё равно клиентский и уже присутствует в bundle;
# так локальная сборка не отключит карты только потому, что Actions недоступен.
MAPS_KEY=""
set -a
# shellcheck disable=SC1090
. "$SECRETS"
set +a

# Источник «Работа в России» (trudvsem) здесь когда-то заводился заново при
# каждом выкате — upsert со `set enabled = true`. Из-за этого миграция 072,
# которая его ВЫКЛЮЧАЛА, отменялась следующим же деплоем, и выключение
# фактически не работало ни дня. Источник удалён миграцией 073, блок убран.
# Урок общий: строка, включающая источник на каждом выкате, сильнее любой
# миграции, которая его выключает.


# Таймер полного импорта «Работы в России» удалён вместе с источником. Юнит
# остаётся на уже выкаченных машинах, поэтому гасим его явно: иначе он и дальше
# будет раз в два часа дёргать ingest.php по несуществующему источнику.
# Команды безопасны при повторах и на машине, где юнита никогда не было.
systemctl disable --now jt-trudvsem-import.timer >/dev/null 2>&1 || true
systemctl disable --now jt-trudvsem-import.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/jt-trudvsem-import.timer /etc/systemd/system/jt-trudvsem-import.service
systemctl daemon-reload
log "INGEST_TIMER $HEAD: trudvsem import timer removed"

# Все интеграции с внешними источниками вакансий удалены (SuperJob, карьерные
# страницы работодателей и т.д.) — оставляем только вакансии, размещённые в
# JobToo напрямую. Юниты остаются на уже выкаченных машинах, поэтому гасим их
# явно: иначе они и дальше будут дёргать удалённые ingest.php/career-discover.
# Команды безопасны при повторах и на машине, где юнита никогда не было.
for unit in jt-superjob-import jt-career-discover; do
  systemctl disable --now "${unit}.timer" >/dev/null 2>&1 || true
  systemctl disable --now "${unit}.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${unit}.timer" "/etc/systemd/system/${unit}.service"
done
systemctl daemon-reload
log "INGEST_TIMER $HEAD: external source timers removed"

MAPS_KEY=${EXPO_PUBLIC_YANDEX_MAPS_KEY:-}
if [ -z "$MAPS_KEY" ] && [ -d /var/www/jobtoo ]; then
  MAPS_KEY=$(python3 - <<'PY' 2>/dev/null || true
from pathlib import Path
import re
root = Path('/var/www/jobtoo')
pat = re.compile(rb'api-maps\.yandex\.ru/2\.1/\?apikey=([^&"\'<>\\]+)&lang=ru_RU')
for p in root.rglob('*'):
    if not p.is_file() or p.stat().st_size > 20_000_000:
        continue
    try:
        m = pat.search(p.read_bytes())
    except Exception:
        continue
    if m:
        print(m.group(1).decode('utf-8', 'ignore'))
        break
PY
)
fi

BUILD_ROOT=/var/lib/jt-web-build
SRC="$BUILD_ROOT/src-$HEAD"
rm -rf "$SRC"
mkdir -p "$SRC" "$WEB_RELEASES"

# Копируем исходники в отдельный каталог: npm ci не трогает рабочий git checkout,
# который одновременно обновляет серверный таймер.
if ! tar -C "$REPO" \
    --exclude=.git --exclude=node_modules --exclude=dist --exclude=.expo \
    -cf - . | tar -C "$SRC" -xf -; then
  log "FAIL $HEAD: source copy"
  rm -rf "$SRC"
  exit 1
fi

log "BUILD $HEAD: start"
if ! timeout 1200 docker run --rm \
    --memory=2600m --memory-swap=4g \
    -e NODE_OPTIONS=--max-old-space-size=2048 \
    -e EXPO_PUBLIC_SUPABASE_URL=https://jobtoo.ru \
    -e EXPO_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-}" \
    -e EXPO_PUBLIC_API_URL=https://jobtoo.ru \
    -e EXPO_PUBLIC_APP_SECRET="${EXPO_PUBLIC_APP_SECRET:-}" \
    -e EXPO_PUBLIC_DASHBOARD_URL=https://admin.jobtoo.ru \
    -e EXPO_PUBLIC_YANDEX_MAPS_KEY="$MAPS_KEY" \
    -v "$SRC:/app" -w /app \
    node:22.13.0-bookworm \
    bash -lc 'npm ci --no-audit --no-fund && npx expo export --platform web --max-workers 2' \
    >>"$LOG" 2>&1; then
  log "FAIL $HEAD: npm/expo build; previous site kept"
  rm -rf "$SRC"
  exit 1
fi

[ -s "$SRC/dist/index.html" ] || {
  log "FAIL $HEAD: dist/index.html missing; previous site kept"
  rm -rf "$SRC"
  exit 1
}

# Значок в Actions менялся после Expo export — сохраняем то же поведение.
if [ -s "$SRC/assets/images/favicon.ico" ]; then
  cp "$SRC/assets/images/favicon.ico" "$SRC/dist/favicon.ico"
fi

# Не допускаем возврата технического CDN, который уже отдавал 403.
if grep -R -q 'j8a6jds2at.cdn.twcstorage.ru' "$SRC/dist" --include='*.html'; then
  log "FAIL $HEAD: forbidden Timeweb CDN reference; previous site kept"
  rm -rf "$SRC"
  exit 1
fi

RELEASE="$WEB_RELEASES/local-$HEAD"
TMP="$RELEASE.tmp"
rm -rf "$TMP" "$RELEASE"
mkdir -p "$TMP"
cp -a "$SRC/dist/." "$TMP/"
rm -rf "$TMP/api" "$TMP/.htaccess"
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"sha":"%s","deployed_at":"%s","builder":"local-server"}\n' \
  "$HEAD" "$DEPLOYED_AT" > "$TMP/jobtoo-build.json"

# Старые установленные PWA могут ещё запросить bundle предыдущей версии.
CURRENT=$(readlink -f /var/www/jobtoo 2>/dev/null || true)
if [ -d "$CURRENT" ]; then
  for tree in _expo/static assets; do
    if [ -d "$CURRENT/$tree" ]; then
      mkdir -p "$TMP/$tree"
      cp -an "$CURRENT/$tree/." "$TMP/$tree/" 2>/dev/null || true
    fi
  done
fi

chmod -R a+rX "$TMP"
mv "$TMP" "$RELEASE"
if [ -d /var/www/jobtoo ] && [ ! -L /var/www/jobtoo ]; then
  mv /var/www/jobtoo "$WEB_RELEASES/pre-local-$(date +%s)"
fi
ln -s "$RELEASE" /var/www/jobtoo.next
mv -Tf /var/www/jobtoo.next /var/www/jobtoo

PUBLISHED=$(readlink -f /var/www/jobtoo 2>/dev/null || true)
if [ "$PUBLISHED" != "$RELEASE" ] || [ ! -s /var/www/jobtoo/index.html ]; then
  if [ -n "$CURRENT" ] && [ -d "$CURRENT" ]; then
    ROLLBACK_LINK=/var/www/jobtoo.rollback.next
    if ln -s "$CURRENT" "$ROLLBACK_LINK" && mv -Tf "$ROLLBACK_LINK" /var/www/jobtoo; then
      log "ROLLBACK $HEAD: restored $CURRENT"
    else
      log "ROLLBACK_FAIL $HEAD: could not restore $CURRENT"
    fi
  fi
  log "FAIL $HEAD: publish verification failed"
  exit 1
fi

echo "$HEAD" > "$STATE"
echo ok > /var/lib/jt-web.ok
log "DEPLOY $HEAD: files=$(find "$RELEASE" -type f | wc -l) maps_key=$([ -n "$MAPS_KEY" ] && echo yes || echo no)"

# Храним текущий и два предыдущих локальных выпуска.
find "$WEB_RELEASES" -mindepth 1 -maxdepth 1 -type d -name 'local-*' ! -path "$RELEASE" -printf '%T@ %p\n' \
  | sort -nr | tail -n +3 | cut -d' ' -f2- | xargs -r rm -rf
rm -rf "$SRC"
exit 0
