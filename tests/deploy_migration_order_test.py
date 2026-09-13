#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
bootstrap = (root / "infra/bootstrap.sh").read_text(encoding="utf-8")
local = (root / "infra/local-web-deploy.sh").read_text(encoding="utf-8")
migrate = (root / "infra/migrate.sh").read_text(encoding="utf-8")

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
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("migration deployment order: ПРОВАЛЫ")
    for name in failed:
        print("  -", name)
    raise SystemExit(1)
print("migration deployment order: ok")
