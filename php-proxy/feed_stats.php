<?php
// Открытые счётчики карьерной ленты: сколько активных вакансий по разделам
// и по компаниям. Решение владельца 26.09.2026 — чтобы решение «пора скрыть
// всё, кроме IT» принималось по числам, а не вслепую.
//
// Только числа, названия компаний и примеры должностей (они и так на сайтах
// работодателей) — ни одной строки о людях. Адрес читается для счёта «только Москва» и наружу не идёт. Ответ кешируется на 10 минут: полный проход по таблице
// на каждый запрос посторонний мог бы превратить в нагрузку на базу.
//
// GET https://jobtoo.ru/api/feed_stats.php

@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=600');
// Открытые числа без людей — читает и раздел «Внешние вакансии» дашборда с
// другого адреса, поэтому любой источник.
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/job_sections.php';

const FS_TTL_SEC = 600;
const FS_PAGE = 1000;
// Москва, удалёнка — тот же шаблон, что в миграции 121 (jm_ext_feed_pool).
const FS_MOSCOW_RE = '([Мм]оскв|МОСКВ|[Mm]oscow|MOSCOW|[Зз]еленоград|ЗЕЛЕНОГРАД|[Уу]дал[её]н|УДАЛ[ЕЁ]Н|[Rr]emote|REMOTE|[Дд]истанц|ДИСТАНЦ)';

// Офисная работа в специальных программах вне ленты (вопрос владельца
// 01.10.2026: «дизайн, продукт-менеджер… но не администратор»). Порядок важен:
// должность попадает в первую подходящую группу. Только счёт по названиям
// должностей работодателей и до пяти примеров на группу — о людях ничего.
const FS_OFFICE_GROUPS = [
    'design'    => '~дизайн|designer|(?<![\p{L}])(ux|ui)(?![\p{L}])|иллюстратор|моушн|motion|3d~iu',
    'product'   => '~продакт|product|проджект|project|менеджер\S* проект|руководител\S* проект|владел\S* продукт|scrum|agile~iu',
    'analytics' => '~аналитик|analyst|analytics|(?<![\p{L}])bi(?![\p{L}])|data|данных~iu',
    'marketing' => '~маркетолог|маркетинг|marketing|(?<![\p{L}])(smm|seo|pr|crm)(?![\p{L}])|контент|таргет|копирайт|редактор|бренд|brand~iu',
    'finance'   => '~бухгалтер|экономист|финанс|аудит|казначе|налог|актуари|инвестиц~iu',
    'hr'        => '~(?<![\p{L}])hr(?![\p{L}])|рекрутер|recruit|подбор\S* персонал|по персоналу|кадр|обучени|t&d~iu',
    'legal'     => '~юрист|юрисконсульт|lawyer|legal|правов|комплаенс|compliance~iu',
    'cad'       => '~проектировщик|конструктор|(?<![\p{L}])(cad|bim)(?![\p{L}])|сметчик|инженер\S*-проект|архитектор~iu',
];
// Не офис в программах, даже если слово совпало: администратор, касса, склад.
const FS_OFFICE_EXCLUDE = '~администратор|кассир|продав|водител|курьер|кладовщ|грузчик|повар|официант|уборщ|охран|оператор колл|call|мерчендайз~iu';

/** Группа офисной должности по названию или null. */
function fs_office_group(string $title): ?string
{
    if ($title === '' || preg_match(FS_OFFICE_EXCLUDE, $title)) return null;
    foreach (FS_OFFICE_GROUPS as $group => $re) {
        if (preg_match($re, $title)) return $group;
    }
    return null;
}

/** Пускает ли фильтр «только Москва» вакансию: метро, Москва/удалёнка в адресе или адреса нет. */
function fs_is_moscow(array $r): bool
{
    if (($r['metro_station_norm'] ?? null) !== null) return true;
    $a = trim((string)($r['address'] ?? ''));
    return $a === '' || preg_match('~' . FS_MOSCOW_RE . '~iu', $a) === 1;
}

/**
 * Счётчики по строкам {company, section, address, metro_station_norm}.
 * it_feed_total — IT без учёта города, feed_total — то, что реально в ленте
 * (IT и Москва). Чистая функция — её проверяет
 * tests/feed_stats_test.php без базы.
 */
function fs_aggregate(array $rows, string $generatedAt, array $itCompanies = []): array
{
    $itSet = array_flip($itCompanies);
    $feed = 0;
    $feedMoscow = 0;
    // Компании, на чьи вакансии в ленте можно откликнуться, — число на сайте
    // (решение владельца 03.10.2026: реальное и живое, а не «500+»).
    $feedCompanies = [];
    $bySection = [];
    $byCompany = [];
    // Москва вне ленты: по разделам и офисные группы по названию.
    $outside = ['total' => 0, 'by_section' => [], 'office_total' => 0, 'office' => []];
    foreach ($rows as $r) {
        $section = (string)($r['section'] ?? '') ?: 'other';
        $company = trim((string)($r['company'] ?? '')) ?: '—';
        $bySection[$section] = ($bySection[$section] ?? 0) + 1;
        $byCompany[$company] ??= ['company' => $company, 'total' => 0, 'it' => 0];
        $byCompany[$company]['total']++;
        if ($section === 'it') $byCompany[$company]['it']++;
        // То, что реально видит соискатель: разделы ленты (it и marketing,
        // миграция 143) или IT-компания без «рабочих» разделов (миграция 132).
        if (in_array($section, JOB_SECTIONS_FEED, true) || (isset($itSet[$company]) && !in_array($section, JOB_SECTIONS_BLUE_COLLAR, true))) {
            $feed++;
            if (fs_is_moscow($r)) {
                $feedMoscow++;
                if ($company !== '—') $feedCompanies[$company] = true;
            }
        } elseif (fs_is_moscow($r)) {
            $outside['total']++;
            $outside['by_section'][$section] = ($outside['by_section'][$section] ?? 0) + 1;
            $title = trim((string)($r['title'] ?? ''));
            $group = fs_office_group($title);
            if ($group !== null) {
                $outside['office_total']++;
                $g = &$outside['office'][$group];
                $g ??= ['total' => 0, 'companies' => [], 'examples' => []];
                $g['total']++;
                $g['companies'][$company] = ($g['companies'][$company] ?? 0) + 1;
                if (count($g['examples']) < 5 && !in_array($title, $g['examples'], true)) {
                    $g['examples'][] = mb_substr($title, 0, 120);
                }
                unset($g);
            }
        }
    }
    arsort($outside['by_section']);
    foreach ($outside['office'] as &$g) {
        arsort($g['companies']);
        $g['companies'] = array_slice($g['companies'], 0, 10, true);
    }
    unset($g);
    uasort($outside['office'], fn($a, $b) => $b['total'] <=> $a['total']);
    arsort($bySection);
    $companies = array_values($byCompany);
    usort($companies, fn($a, $b) => [$b['it'], $b['total']] <=> [$a['it'], $a['total']]);
    return [
        'generated_at' => $generatedAt,
        'total' => count($rows),
        'it_total' => $bySection['it'] ?? 0,
        'it_feed_total' => $feed,
        'feed_total' => $feedMoscow,
        'feed_companies' => count($feedCompanies),
        'companies' => count($companies),
        'it_companies' => count(array_filter($companies, fn($c) => $c['it'] > 0)),
        'by_section' => $bySection,
        'by_company' => $companies,
        'outside_feed_moscow' => $outside,
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
        ], 'company,section,title,address,metro_station_norm');
        $rows = array_merge($rows, $page);
        if (count($page) < FS_PAGE) break;
    }

    $itCompanies = array_column(sb_select('jm_it_companies', [], 'company'), 'company');
    $json = json_encode(fs_aggregate($rows, gmdate('Y-m-d\TH:i:s\Z'), $itCompanies), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    @file_put_contents($cache, $json, LOCK_EX);
    echo $json;
}
