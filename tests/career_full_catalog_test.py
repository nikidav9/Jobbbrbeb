#!/usr/bin/env python3
"""Регрессия: «полный каталог» не должен снова свалиться к одной вакансии."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sync = (ROOT / 'infra/sync-career-catalog.sh').read_text(encoding='utf-8')
migration = (ROOT / 'supabase/migrations/089_consolidate_career_catalog.sql').read_text(encoding='utf-8')
career = (ROOT / 'php-proxy/career.php').read_text(encoding='utf-8')

failures = []

def check(name: str, ok: bool) -> None:
    if not ok:
        failures.append(name)

# Master-list остаётся полным, но raw-страницы больше не являются единственным
# runtime-источником: именно это давало одну JobPosting-вакансию.
check('master-list хранится отдельно для discovery', "'catalog_pages', :'catalog_pages'::jsonb" in sync)
check('runtime получает проверенные endpoints', "connector_config->'endpoints'" in sync)
# Проверка сторожа, а не его формулировки. Раньше здесь стояла строка «нет
# проверенных карьерных endpoints», а сам скрипт давно говорит иначе — и
# проверка молча краснела, никого не останавливая: в CI этот файл не подключён.
check('пустые endpoints роняют выкладку',
      'raise exception' in sync and 'не осталось карьерных endpoints' in sync)
check('sync не кладёт raw master-list обратно в pages', "'pages', :'catalog_pages'::jsonb" not in sync)

# Уже работающие вакансии не должны исчезнуть на время первого нового обхода.
check('старые вакансии сразу переезжают в полный каталог',
      "set source_id = 'career_owner'" in migration and "where source_id = 'career';" in migration)
check('старый источник отключается после переноса',
      "enabled = false" in migration and "where id = 'career';" in migration)
check('полный каталог остаётся включён',
      "enabled = true" in migration and "where id = 'career_owner';" in migration)

# Фильтр компании не должен показывать четыре варианта Яндекс Лавки.
check('варианты Яндекс Лавки нормализуются',
      "set company = 'Лавка'" in migration
      and "'яндекславка'" in migration
      and "'оояндекславка'" in migration)

# Сам карьерный endpoint по-прежнему умеет обрабатывать endpoints из config.
check('career.php читает endpoints', "config['endpoints']" in career)
check('career.php поддерживает JSON mapping', "cf_json_items($data, $unit['map']" in career)

if failures:
    print('career full catalog: ПРОВАЛЫ')
    for item in failures:
        print('  -', item)
    sys.exit(1)
print('career full catalog: ok')
