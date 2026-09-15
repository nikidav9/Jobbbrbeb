#!/usr/bin/env python3
"""Кэш sitemap обязан сбрасываться при изменении данных, влияющих на /rabota/.

Продакшен уже поймал конкретную регрессию: sitemap час помнил страницу
/rabota/brigadir/bratislavskaya, а после обновления вакансий сама страница
оказалась ниже LP_MIN и честно ответила 404. TTL здесь не спасает контракт —
нужна инвалидация в точках записи.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
cache = (ROOT / 'php-proxy/sitemap_cache.php').read_text(encoding='utf-8')
sitemap = (ROOT / 'php-proxy/sitemap.php').read_text(encoding='utf-8')
ingest = (ROOT / 'php-proxy/ingest.php').read_text(encoding='utf-8')
db = (ROOT / 'php-proxy/db.php').read_text(encoding='utf-8')
ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')

failures = []

def check(name: str, ok: bool) -> None:
    if not ok:
        failures.append(name)


def case_block(name: str) -> str:
    marker = f"case '{name}':"
    start = db.find(marker)
    if start < 0:
        return ''
    end = db.find("\n        case '", start + len(marker))
    return db[start:end if end >= 0 else len(db)]

check('есть явная инвалидация sitemap-кэша', 'function sm_cache_invalidate' in cache)
check('production путь кэша задан в одном helper', 'function sm_cache_default_path' in cache)
check('sitemap использует общий путь кэша', 'sm_cache_default_path()' in sitemap)
check('sitemap больше не дублирует /tmp путь', "const SM_CACHE_FILE = '/tmp/jobtoo-sitemap-v1.xml'" not in sitemap)

# Полный/частичный ingest может поменять метро, профессию или active у уже
# существующей вакансии. Сбрасываем после upsert и после погашения старых строк.
check('ingest подключает cache helper', "require_once __DIR__ . '/sitemap_cache.php';" in ingest)
upsert_pos = ingest.find("sb_upsert_rows('jm_ext_vacancies'")
check('ingest пишет вакансии', upsert_pos >= 0)
check('ingest сбрасывает карту сразу после upsert',
      upsert_pos >= 0 and 'sm_cache_invalidate();' in ingest[upsert_pos:upsert_pos + 350])
stale_pos = ingest.find("['active' => false]")
check('ingest гасит пропавшие вакансии', stale_pos >= 0)
check('ingest сбрасывает карту после деактивации',
      stale_pos >= 0 and 'sm_cache_invalidate();' in ingest[stale_pos:stale_pos + 350])

# Свои смены входят в lp_collect, поэтому create/update/delete/autoclose тоже
# могут пересечь LP_MIN. Постоянные вакансии в lp_collect не входят.
for fn in ('dbUpsertVacancy', 'dbUpsertVacancyBatch', 'dbUpdateVacancy',
           'dbDeleteVacancy', 'dbAutoClosePastVacancies'):
    block = case_block(fn)
    check(f'{fn}: case найден', bool(block))
    check(f'{fn}: sitemap invalidated', 'sm_cache_invalidate();' in block)

# Включение/выключение/удаление источника меняет тот же набор мгновенно.
for fn in ('extSourceSave', 'extSourceDelete'):
    block = case_block(fn)
    check(f'{fn}: case найден', bool(block))
    check(f'{fn}: sitemap invalidated', 'sm_cache_invalidate();' in block)

check('регрессия запускается в основном CI', 'python3 tests/sitemap_invalidation_test.py' in ci)

if failures:
    print('sitemap invalidation: ПРОВАЛЫ')
    for item in failures:
        print('  -', item)
    sys.exit(1)
print('sitemap invalidation: OK')
