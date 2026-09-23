#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
bootstrap = (root / "infra/bootstrap.sh").read_text(encoding="utf-8")
local = (root / "infra/local-web-deploy.sh").read_text(encoding="utf-8")
migrate = (root / "infra/migrate.sh").read_text(encoding="utf-8")
guard = (root / "infra/verify-rls.sh").read_text(encoding="utf-8")
report = (root / "infra/report.sh").read_text(encoding="utf-8")
availability = (root / "infra/check-site.sh").read_text(encoding="utf-8")
tls = (root / "infra/nginx-tls.conf").read_text(encoding="utf-8")
lockdown = (root / "supabase/migrations/013_lock_down_rls.sql").read_text(encoding="utf-8")

protected = sorted(set(re.findall(r"'((?:jm_)[a-z0-9_]+)'", lockdown)))

# Таблицы, заведённые позже 013: защиту они включают сами, и сторож обязан
# их видеть. Иначе новая таблица тихо выпадает из проверки — а замечают это
# обычно после того, как из неё что-то утекло.
#
# Список строится проходом по миграциям в том же порядке, в каком их катит
# infra/migrate.sh, и учитывает удаления. Без этого сторож требовал охранять
# jm_ext_clicks — таблицу, которую миграция 096 снесла полтора месяца назад:
# регулярка видела «включён RLS» в миграции 036 и не видела drop в 096.
# Требование охранять несуществующее выглядит как строгость, а работает
# наоборот: строку держат в списке, чтобы проверка молчала, и перестают
# понимать, что в этом списке настоящее.
rls_enabled: set[str] = set()
alive: set[str] = set()
for path in sorted((root / "supabase/migrations").glob("*.sql"), key=lambda p: p.name):
    body = path.read_text(encoding="utf-8")
    number = int(path.name.split("_", 1)[0])
    for name in re.findall(r"create table (?:if not exists )?(?:public\.)?(jm_[a-z0-9_]+)", body):
        alive.add(name)
    for name in re.findall(
        r"alter table (?:if exists )?(?:public\.)?(jm_[a-z0-9_]+) enable row level security",
        body,
    ):
        if number > 13:
            rls_enabled.add(name)
    for name in re.findall(r"drop table (?:if exists )?(?:public\.)?(jm_[a-z0-9_]+)", body):
        alive.discard(name)
        rls_enabled.discard(name)

later_tables = sorted(rls_enabled & alive)
missing_guard_tables = [
    name for name in protected + later_tables if f"('{name}')" not in guard
]

checks = {
    "неготовый Storage считается ошибкой": (
        'say "миграции" "storage ещё не готов, отложено"\n  exit 1' in migrate
    ),
    "bootstrap проверяет миграции до замены PHP": (
        bootstrap.index('bash "$REPO/infra/migrate.sh"')
        < bootstrap.index('cp -f "$REPO"/php-proxy/*.php')
    ),
    "bootstrap оставляет прежний PHP при ошибке": (
        'if [ "$MIGRATIONS_READY" = 1 ]; then\n  cp -f "$REPO"/php-proxy/*.php' in bootstrap
    ),
    "bootstrap не меняет сайт при ошибке": (
        'if [ "$MIGRATIONS_READY" != 1 ]; then' in bootstrap
        and 'обновление отложено до успешных миграций' in bootstrap
    ),
    "локальная выкладка прекращается при ошибке": (
        'MIGRATE_FAIL $HEAD: see /var/log/jt-apply.log"\n    exit 1' in local
        and 'MIGRATE_FAIL $HEAD: migrator unavailable"\n  exit 1' in local
    ),
    "мигратор проверяет живой RLS-контур": (
        'verify-rls.sh' in migrate and 'RLS GUARD' in migrate
    ),
    "мигратор публикует минимальный security status после RLS guard": (
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
    "RLS guard проверяет факт применения migration 013": (
        "013_lock_down_rls.sql" in guard and "jm_migrations" in guard
    ),
    "RLS guard проверяет relrowsecurity": "relrowsecurity" in guard,
    "RLS guard проверяет права anon": "has_table_privilege('anon'" in guard,
    "RLS guard проверяет права authenticated": "has_table_privilege('authenticated'" in guard,
    "RLS guard покрывает все защищённые таблицы": (
        bool(protected) and not missing_guard_tables
    ),
    "поздние таблицы включают RLS в своей миграции": bool(later_tables),
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("migration deployment order: ПРОВАЛЫ")
    for name in failed:
        print("  -", name)
    if missing_guard_tables:
        print("  - отсутствуют в RLS guard:", ", ".join(missing_guard_tables))
    raise SystemExit(1)
print(
    "migration deployment order: ok; RLS guard covers "
    f"{len(set(protected + later_tables))} tables"
)
