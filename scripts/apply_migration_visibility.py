from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'infra/report.sh',
    '''  echo "  \\"версия\\": \\"$(cd /opt/jobtoo 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo нет)\\","
  # Отдельной строкой, с адресом, а не только номером порта: прокси работает
''',
    '''  echo "  \\"версия\\": \\"$(cd /opt/jobtoo 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo нет)\\","

  # Не только «файл миграции есть в репозитории», а что реально применено к
  # живой БД. Внешний монитор сравнивает это поле с последним SQL в main.
  # Значение — только имя файла, никаких данных или секретов наружу не уходит.
  latest_migration=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T \\
       -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \\
       psql -tAq -U supabase_admin -d postgres -c \\
       "select name from jm_migrations order by name desc limit 1" 2>/dev/null \\
       | tr -d '\\"\\r\\n' | cut -c1-160)
  echo "  \\"последняя_миграция\\": \\"${latest_migration:-не прочитать}\\","

  # Отдельной строкой, с адресом, а не только номером порта: прокси работает
''',
    'status exposes applied migration',
)

# Compare the public server report with the repository we are testing. This is
# deployment integrity, not a synthetic HTTP uptime signal, so keep it outside
# the per-sample flap counters.
replace_once(
    'infra/check-site.sh',
    '''record() {
  local key=$1
  [[ $PROBE_OK -eq 1 ]] || { fails[$key]=$(( fails[$key]+1 )); }
}

for i in $(seq 1 "$SAMPLES"); do
''',
    '''record() {
  local key=$1
  [[ $PROBE_OK -eq 1 ]] || { fails[$key]=$(( fails[$key]+1 )); }
}

# Сайт может отвечать 200, пока PHP уже новый, а БД ещё старая. Это самый
# опасный «зелёный» deploy: ошибка проявится только при первом запросе к новой
# функции/колонке. Сверяем то, что применено на сервере, с последним SQL в
# checkout этого monitor-run.
expected_migration=$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\\n' \\
  | LC_ALL=C sort | tail -1)
status_json="$RUNNER_TEMP/jobtoo-status.json"
probe_url migration_status "https://$FALLBACK_HOST/status.json" -4 "$status_json"
if [[ $PROBE_OK -eq 1 ]]; then
  applied_migration=$(python3 - "$status_json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        value = json.load(f).get('последняя_миграция', '')
    print(value if isinstance(value, str) else '')
except Exception:
    print('')
PY
  )
  echo "migration_expected=${expected_migration:-нет} migration_applied=${applied_migration:-нет}"
  if [[ -z "$expected_migration" || "$applied_migration" != "$expected_migration" ]]; then
    echo "ERROR: production migration mismatch: expected=${expected_migration:-нет} applied=${applied_migration:-нет}"
    failed=1
  fi
else
  echo "ERROR: production status report unavailable; migration parity unknown"
  failed=1
fi

for i in $(seq 1 "$SAMPLES"); do
''',
    'availability checks migration parity',
)

# Extend the deploy-order regression test with the new observable invariant.
test = Path('tests/deploy_migration_order_test.py')
t = test.read_text()
replace_once(
    'tests/deploy_migration_order_test.py',
    '''guard = (root / "infra/verify-rls.sh").read_text(encoding="utf-8")
lockdown = (root / "supabase/migrations/013_lock_down_rls.sql").read_text(encoding="utf-8")
''',
    '''guard = (root / "infra/verify-rls.sh").read_text(encoding="utf-8")
report = (root / "infra/report.sh").read_text(encoding="utf-8")
availability = (root / "infra/check-site.sh").read_text(encoding="utf-8")
lockdown = (root / "supabase/migrations/013_lock_down_rls.sql").read_text(encoding="utf-8")
''',
    'migration test reads monitoring scripts',
)
replace_once(
    'tests/deploy_migration_order_test.py',
    '''    "мигратор проверяет живой RLS-контур": (
        'verify-rls.sh' in migrate and 'RLS GUARD' in migrate
    ),
''',
    '''    "мигратор проверяет живой RLS-контур": (
        'verify-rls.sh' in migrate and 'RLS GUARD' in migrate
    ),
    "публичный статус показывает реально применённую миграцию": (
        'последняя_миграция' in report and 'from jm_migrations order by name desc limit 1' in report
    ),
    "внешний монитор сверяет production с последним SQL в main": (
        'expected_migration=' in availability
        and 'migration_applied=' in availability
        and 'production migration mismatch' in availability
    ),
''',
    'migration parity regression checks',
)
