#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} anchors, found {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')


# Sitemap: один общий путь к cache helper; серверный XML можно держать час,
# но внешним кэшам даём максимум 5 минут — их локальным unlink не сбросить.
replace_exact(
    'php-proxy/sitemap.php',
    "const SM_CACHE_TTL = 3600;\nconst SM_CACHE_FILE = '/tmp/jobtoo-sitemap-v1.xml';\n\n$cached = sm_cache_read(SM_CACHE_FILE, time(), SM_CACHE_TTL);",
    "const SM_CACHE_TTL = 3600;\nconst SM_HTTP_CACHE_TTL = 300;\n$smCacheFile = sm_cache_default_path();\n\n$cached = sm_cache_read($smCacheFile, time(), SM_CACHE_TTL);",
)
replace_exact(
    'php-proxy/sitemap.php',
    "header('Cache-Control: public, max-age=' . SM_CACHE_TTL);",
    "header('Cache-Control: public, max-age=' . SM_HTTP_CACHE_TTL);",
    expected=2,
)
replace_exact(
    'php-proxy/sitemap.php',
    "sm_cache_write(SM_CACHE_FILE, $xml);",
    "sm_cache_write($smCacheFile, $xml);",
)

# Partner ingest может менять не только active, но и metro/work_type существующей
# строки. Любой upsert способен пересечь LP_MIN, поэтому invalidate сразу после
# записи, а не только после финального погашения старых строк.
replace_exact(
    'php-proxy/ingest.php',
    "require_once __DIR__ . '/safe_url.php';",
    "require_once __DIR__ . '/safe_url.php';\nrequire_once __DIR__ . '/sitemap_cache.php';",
)
replace_exact(
    'php-proxy/ingest.php',
    "            sb_upsert_rows('jm_ext_vacancies', $chunk, 'source_id,external_id');\n",
    "            sb_upsert_rows('jm_ext_vacancies', $chunk, 'source_id,external_id');\n            sm_cache_invalidate();\n",
)
replace_exact(
    'php-proxy/ingest.php',
    "        $gone = count($stale);\n",
    "        $gone = count($stale);\n        if ($gone > 0) sm_cache_invalidate();\n",
)

# db.php — свои смены входят в lp_collect; источник production/enabled тоже.
replace_exact(
    'php-proxy/db.php',
    "require_once __DIR__ . '/feed_funnel.php';",
    "require_once __DIR__ . '/feed_funnel.php';\nrequire_once __DIR__ . '/sitemap_cache.php';",
)
replace_exact(
    'php-proxy/db.php',
    "            save_then_geocode('jm_vacancies', $args[0]); break;",
    "            save_then_geocode('jm_vacancies', $args[0]);\n            sm_cache_invalidate(); break;",
)
replace_exact(
    'php-proxy/db.php',
    "            sb_upsert('jm_vacancies', $rows, 'id'); break;",
    "            sb_upsert('jm_vacancies', $rows, 'id');\n            sm_cache_invalidate(); break;",
)
replace_exact(
    'php-proxy/db.php',
    "            sb_update('jm_vacancies', ['id' => 'eq.' . $args[0]], fill_coords($args[1])); break;",
    "            sb_update('jm_vacancies', ['id' => 'eq.' . $args[0]], fill_coords($args[1]));\n            sm_cache_invalidate(); break;",
)
replace_exact(
    'php-proxy/db.php',
    "        case 'dbDeleteVacancy':\n            sb_delete('jm_vacancies', ['id' => 'eq.' . $args[0]]); break;",
    "        case 'dbDeleteVacancy':\n            sb_delete('jm_vacancies', ['id' => 'eq.' . $args[0]]);\n            sm_cache_invalidate(); break;",
)
replace_exact(
    'php-proxy/db.php',
    "            $data = count($toClose);\n            break;",
    "            $data = count($toClose);\n            if ($data > 0) sm_cache_invalidate();\n            break;",
)
replace_exact(
    'php-proxy/db.php',
    "            sb_upsert('jm_ext_sources', $row, 'id');\n            $data = ['ok' => true, 'id' => $row['id']]; break;",
    "            sb_upsert('jm_ext_sources', $row, 'id');\n            sm_cache_invalidate();\n            $data = ['ok' => true, 'id' => $row['id']]; break;",
)
replace_exact(
    'php-proxy/db.php',
    "            sb_delete('jm_ext_sources', ['id' => 'eq.' . $id]);\n            $data = ['ok' => true]; break;",
    "            sb_delete('jm_ext_sources', ['id' => 'eq.' . $id]);\n            sm_cache_invalidate();\n            $data = ['ok' => true]; break;",
)

print('sitemap freshness patch applied')
