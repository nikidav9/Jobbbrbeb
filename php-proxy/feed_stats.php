<?php
// Открытые счётчики карьерной ленты: сколько активных вакансий по разделам
// и по компаниям. Решение владельца 26.09.2026 — чтобы решение «пора скрыть
// всё, кроме IT» принималось по числам, а не вслепую.
//
// Только числа и названия компаний (они и так в открытой ленте) — ни одной
// строки о людях. Ответ кешируется на 10 минут: полный проход по таблице
// на каждый запрос посторонний мог бы превратить в нагрузку на базу.
//
// GET https://jobtoo.ru/api/feed_stats.php

@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=600');

require_once __DIR__ . '/sb_lite.php';

const FS_TTL_SEC = 600;
const FS_PAGE = 1000;

/**
 * Счётчики по строкам {company, section}. Чистая функция — её проверяет
 * tests/feed_stats_test.php без базы.
 */
function fs_aggregate(array $rows, string $generatedAt, array $itCompanies = []): array
{
    $itSet = array_flip($itCompanies);
    $feed = 0;
    $bySection = [];
    $byCompany = [];
    foreach ($rows as $r) {
        $section = (string)($r['section'] ?? '') ?: 'other';
        $company = trim((string)($r['company'] ?? '')) ?: '—';
        $bySection[$section] = ($bySection[$section] ?? 0) + 1;
        $byCompany[$company] ??= ['company' => $company, 'total' => 0, 'it' => 0];
        $byCompany[$company]['total']++;
        if ($section === 'it') $byCompany[$company]['it']++;
        // То, что реально видит соискатель: раздел it или IT-компания целиком.
        if ($section === 'it' || isset($itSet[$company])) $feed++;
    }
    arsort($bySection);
    $companies = array_values($byCompany);
    usort($companies, fn($a, $b) => [$b['it'], $b['total']] <=> [$a['it'], $a['total']]);
    return [
        'generated_at' => $generatedAt,
        'total' => count($rows),
        'it_total' => $bySection['it'] ?? 0,
        'it_feed_total' => $feed,
        'companies' => count($companies),
        'it_companies' => count(array_filter($companies, fn($c) => $c['it'] > 0)),
        'by_section' => $bySection,
        'by_company' => $companies,
    ];
}

if (!defined('FEED_STATS_LIBRARY_ONLY')) {
    $cache = sys_get_temp_dir() . '/jt_feed_stats.json';
    if (is_readable($cache) && time() - (int)@filemtime($cache) < FS_TTL_SEC) {
        readfile($cache);
        exit;
    }

    $rows = [];
    for ($offset = 0; $offset < 200000; $offset += FS_PAGE) {
        $page = sb_select('jm_ext_vacancies', [
            'active' => 'is.true',
            'order' => 'id.asc',
            'limit' => (string)FS_PAGE,
            'offset' => (string)$offset,
        ], 'company,section');
        $rows = array_merge($rows, $page);
        if (count($page) < FS_PAGE) break;
    }

    $itCompanies = array_column(sb_select('jm_it_companies', [], 'company'), 'company');
    $json = json_encode(fs_aggregate($rows, gmdate('Y-m-d\TH:i:s\Z'), $itCompanies), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    @file_put_contents($cache, $json, LOCK_EX);
    echo $json;
}
