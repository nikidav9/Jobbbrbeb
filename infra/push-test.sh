#!/bin/bash
# Разовая проверка пушей (03.10.2026): отправляет обезличенный пуш всем, у кого
# сохранён токен, и пишет итог в /var/www/html/push-test-status.json — его
# показывает security-status.json полем push_test. Запуск из bootstrap.sh один
# раз на каждое новое содержимое infra/push-test-now. Токены в итог не идут.
set -u
REPO=${REPO:-/opt/jobtoo}
PROXY=${PROXY:-/opt/jobtoo-proxy}
STATUS=/var/www/html/push-test-status.json
cd "$REPO/infra" || exit 1
set -a; . /opt/jobtoo-secrets/env; set +a
q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

RES=$(q -tAc "select push_token from jm_users where push_token is not null" 2>/dev/null \
      | php "$REPO/infra/push-test.php" "$PROXY" 2>&1 | tail -n 1)
python3 - "$RES" "$STATUS" <<'PY'
import json, sys, datetime
try:
    d = json.loads(sys.argv[1])
except Exception:
    d = {"error": "сбой запуска", "raw": sys.argv[1][:200]}
d["at"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
open(sys.argv[2] + ".tmp", "w").write(json.dumps(d, ensure_ascii=False))
import os; os.replace(sys.argv[2] + ".tmp", sys.argv[2])
PY
echo "$(date -Is) [пуш-проверка] готово" >> /var/log/jt-apply.log
