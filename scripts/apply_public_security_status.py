from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# After the live RLS guard succeeds, publish a deliberately tiny status file.
# Detailed /status.json stays private: it contains ports, logs and DB topology.
replace_once(
    'infra/migrate.sh',
    '''if ! bash "$REPO/infra/verify-rls.sh" >/tmp/jt-rls.log 2>&1; then
  say "миграции" "RLS GUARD: $(tail -10 /tmp/jt-rls.log | tr '\\n' ' ' | cut -c1-500)"
  exit 1
fi

if [ "$applied" -gt 0 ]; then
''',
    '''if ! bash "$REPO/infra/verify-rls.sh" >/tmp/jt-rls.log 2>&1; then
  say "миграции" "RLS GUARD: $(tail -10 /tmp/jt-rls.log | tr '\\n' ' ' | cut -c1-500)"
  exit 1
fi

# Наружу нужен только факт: какая миграция реально применена и прошёл ли
# живой RLS guard. Подробный status.json намеренно остаётся закрытым: там
# порты, логи и топология БД. Пишем атомарно, чтобы монитор не увидел полфайла.
latest_migration=$(q -tAc "select name from jm_migrations order by name desc limit 1" 2>/dev/null | tr -d '\\r\\n')
status_tmp=$(mktemp /var/www/html/security-status.json.XXXXXX)
printf '{"generated_at":"%s","latest_migration":"%s","rls_guard":true}\\n' \\
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$latest_migration" > "$status_tmp"
chmod 644 "$status_tmp"
mv -f "$status_tmp" /var/www/html/security-status.json

if [ "$applied" -gt 0 ]; then
''',
    'publish minimal security status after RLS guard',
)

# The fallback TLS host exposes only the tiny status file. The verbose report
# remains explicitly 404 from the Internet.
replace_once(
    'infra/nginx-tls.conf',
    '''    location = /health { default_type application/json; add_header Cache-Control "no-store" always; return 200 '{"ok":true}\\n'; }
    location = /status.json { return 404; }
''',
    '''    location = /health { default_type application/json; add_header Cache-Control "no-store" always; return 200 '{"ok":true}\\n'; }
    location = /security-status.json {
        alias /var/www/html/security-status.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
    location = /status.json { return 404; }
''',
    'safe public security status endpoint',
)

# External monitor validates migration parity, fresh generation time, and the
# live RLS guard result. A stale last-known-good file must not hide a broken
# migrator, so anything older than five minutes fails the check.
check = Path('infra/check-site.sh')
text = check.read_text(encoding='utf-8')
start = text.find("expected_migration=$(find supabase/migrations")
end = text.find('\nfor i in $(seq 1 "$SAMPLES"); do', start)
if start < 0 or end <= start:
    raise SystemExit('migration status block markers not found')
new_block = r'''expected_migration=$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
  | LC_ALL=C sort | tail -1)
status_json="$RUNNER_TEMP/jobtoo-security-status.json"
probe_url security_status "https://$FALLBACK_HOST/security-status.json" -4 "$status_json"
if [[ $PROBE_OK -eq 1 ]]; then
  read -r applied_migration rls_guard status_age < <(python3 - "$status_json" <<'PY'
import datetime as dt
import json
import sys

try:
    with open(sys.argv[1], encoding='utf-8') as f:
        value = json.load(f)
    migration = value.get('latest_migration', '')
    rls = value.get('rls_guard') is True
    raw_time = value.get('generated_at', '')
    stamp = dt.datetime.fromisoformat(raw_time.replace('Z', '+00:00'))
    age = int((dt.datetime.now(dt.timezone.utc) - stamp).total_seconds())
    print(migration if isinstance(migration, str) else '', 'true' if rls else 'false', age)
except Exception:
    print('', 'false', 999999)
PY
  )
  echo "migration_expected=${expected_migration:-нет} migration_applied=${applied_migration:-нет} rls_guard=$rls_guard status_age=${status_age}s"
  if [[ -z "$expected_migration" || "$applied_migration" != "$expected_migration" ]]; then
    echo "ERROR: production migration mismatch: expected=${expected_migration:-нет} applied=${applied_migration:-нет}"
    failed=1
  fi
  if [[ "$rls_guard" != true ]]; then
    echo "ERROR: production RLS guard is not green"
    failed=1
  fi
  if [[ ! "$status_age" =~ ^-?[0-9]+$ || "$status_age" -lt 0 || "$status_age" -gt 300 ]]; then
    echo "ERROR: production security status is stale: age=${status_age:-unknown}s"
    failed=1
  fi
else
  echo "ERROR: production security status unavailable; migration/RLS parity unknown"
  failed=1
fi
'''
check.write_text(text[:start] + new_block + text[end:], encoding='utf-8')

# Strengthen the existing deployment-order test around the public/private
# boundary so nobody later points the monitor back at verbose status.json.
test_path = Path('tests/deploy_migration_order_test.py')
test = test_path.read_text(encoding='utf-8')
test = replace_once_text = test
old_read = '''report = (root / "infra/report.sh").read_text(encoding="utf-8")
availability = (root / "infra/check-site.sh").read_text(encoding="utf-8")
lockdown = (root / "supabase/migrations/013_lock_down_rls.sql").read_text(encoding="utf-8")
'''
new_read = '''report = (root / "infra/report.sh").read_text(encoding="utf-8")
availability = (root / "infra/check-site.sh").read_text(encoding="utf-8")
tls = (root / "infra/nginx-tls.conf").read_text(encoding="utf-8")
lockdown = (root / "supabase/migrations/013_lock_down_rls.sql").read_text(encoding="utf-8")
'''
if test.count(old_read) != 1:
    raise SystemExit('test imports: expected exactly one match')
test = test.replace(old_read, new_read, 1)
old_checks = '''    "публичный статус показывает реально применённую миграцию": (
        'последняя_миграция' in report and 'from jm_migrations order by name desc limit 1' in report
    ),
    "внешний монитор сверяет production с последним SQL в main": (
        'expected_migration=' in availability
        and 'migration_applied=' in availability
        and 'production migration mismatch' in availability
    ),
'''
new_checks = '''    "мигратор публикует минимальный security status после RLS guard": (
        'security-status.json' in migrate
        and 'latest_migration' in migrate
        and '"rls_guard":true' in migrate
        and migrate.index('verify-rls.sh') < migrate.index('security-status.json')
    ),
    "подробный status остаётся закрытым": 'location = /status.json { return 404; }' in tls,
    "наружу отдаётся только security status": (
        'location = /security-status.json' in tls
        and 'alias /var/www/html/security-status.json;' in tls
    ),
    "внешний монитор сверяет production с последним SQL и RLS": (
        'expected_migration=' in availability
        and 'migration_applied=' in availability
        and 'production migration mismatch' in availability
        and 'rls_guard' in availability
        and 'status_age' in availability
        and '/security-status.json' in availability
    ),
'''
if test.count(old_checks) != 1:
    raise SystemExit('test migration status checks: expected exactly one match')
test_path.write_text(test.replace(old_checks, new_checks, 1), encoding='utf-8')

print('safe production security status patch applied')
