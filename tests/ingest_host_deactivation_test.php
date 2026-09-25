<?php
// Закрытые вакансии гаснут по сайтам, а ежечасный заход по API не гасит ничего.
//
// Карьерный источник — это десятки работодателей в одном обходе. Раньше
// хватало одного 403 у любого из них, чтобы круг стал «не весь» и не гасилось
// НИЧЕГО: закрытая вакансия висела в ленте до недели. Теперь сайт, чьи адреса
// прошли целиком, гасит свои пропавшие вакансии сразу. Ошибка здесь дорогая в
// обе стороны: не погасили — человек откликается на закрытое; погасили лишнее —
// вакансия молча пропала из ленты.
//
// INGEST_LIBRARY_ONLY гасит точку входа; база — заглушка (sb_lite.php обёрнут
// в if (!function_exists('sb'))).
define('INGEST_LIBRARY_ONLY', true);

$GLOBALS['TABLES'] = [];
function sb(string $m, string $t, array $q = [], $b = null, array $e = []): array { return []; }
function sb_single(string $t, array $f = [], string $sel = '*'): ?array { return sb_select($t, $f)[0] ?? null; }
function sb_upsert_rows(string $t, array $r, string $c): void {}
function sb_insert(string $t, array $r): void {}
function now_iso(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function sb_lite_url(): string { return 'https://jobtoo.ru'; }
function sb_lite_key(): string { return 'test'; }

/** Фильтр PostgREST в той мере, в какой им пользуется гашение. */
function stub_match(array $row, array $f): bool
{
    foreach ($f as $col => $cond) {
        $cond = (string)$cond;
        $val = (string)($row[$col] ?? '');
        if (str_starts_with($cond, 'eq.')) { if ($val !== substr($cond, 3)) return false; }
        elseif ($cond === 'is.true') { if (empty($row[$col])) return false; }
        elseif (str_starts_with($cond, 'lt.')) { if (!($val < substr($cond, 3))) return false; }
        elseif (str_starts_with($cond, 'like.')) {
            $re = '~^' . str_replace('\*', '.*', preg_quote(substr($cond, 5), '~')) . '$~';
            if (!preg_match($re, $val)) return false;
        }
        elseif (str_starts_with($cond, 'in.(')) {
            if (!in_array($val, explode(',', trim(substr($cond, 3), '()')), true)) return false;
        }
        else throw new RuntimeException("заглушка не знает фильтра $cond");
    }
    return true;
}
function sb_select(string $t, array $f = [], string $sel = '*'): array
{
    return array_values(array_filter($GLOBALS['TABLES'][$t] ?? [], fn($r) => stub_match($r, $f)));
}
function sb_select_all(string $t, array $f = [], string $sel = '*'): array { return sb_select($t, $f, $sel); }
function sb_update(string $t, array $f, array $d): void
{
    foreach ($GLOBALS['TABLES'][$t] ?? [] as $i => $r) {
        if (stub_match($r, $f)) $GLOBALS['TABLES'][$t][$i] = array_merge($r, $d);
    }
}

require_once __DIR__ . '/../php-proxy/ingest.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Какие сайты прошли целиком ───────────────────────────────────────────────
$hosts = ing_complete_hosts(
    [
        '0' => ['kontur.ru' => true],
        '1' => ['x5.tech' => true],
        '2' => ['career.nornickel.ru' => true],   // первая порция пришла…
        '3' => ['selectel.ru' => true],
        '4' => ['petrovichjob.ru' => true],        // из отказа адреса (hosts в failed)
    ],
    ['2' => true, '4' => true]                     // …а вторая споткнулась
);
sort($hosts);
check('гасим только сайты без сбоев', $hosts === ['kontur.ru', 'selectel.ru', 'x5.tech']);
check('сайт, у которого один адрес прошёл, а другой упал, не гасим',
    !in_array('ibs.ru', ing_complete_hosts(['0' => ['ibs.ru' => true], '1' => ['ibs.ru' => true]], ['1' => true]), true));
check('без адресов — без гашения', ing_complete_hosts([], []) === []);

// ── Само гашение по сайту ────────────────────────────────────────────────────
$start = '2026-09-25T20:30:00Z';
$old = '2026-09-25T14:30:00Z';
$fresh = '2026-09-25T20:35:00Z';
$row = fn(string $id, string $url, string $seen, bool $active = true, string $src = 'career_owner') =>
    ['id' => $id, 'source_id' => $src, 'url' => $url, 'last_seen_at' => $seen, 'active' => $active];
$GLOBALS['TABLES']['jm_ext_vacancies'] = [
    $row('kontur-city', 'https://kontur.ru/career/vacancies/city-6590', $old),        // мусор прошлых кругов
    $row('kontur-closed', 'https://kontur.ru/career/vacancies/100', $old),             // закрыта
    $row('kontur-live', 'https://kontur.ru/career/vacancies/5818', $fresh),            // видели сейчас
    $row('croc-old', 'https://careers.croc.ru/vacancies/x/', $old),                    // сайт не прошёл
    $row('fake-host', 'https://evil.kontur.ru.example/vacancies/1', $old),             // похожий хост
    $row('other-src', 'https://kontur.ru/career/vacancies/7', $old, true, 'hh'),       // чужой источник
];
$gone = ing_deactivate_stale('career_owner', $start, 'kontur.ru');
$active = array_column(array_filter($GLOBALS['TABLES']['jm_ext_vacancies'], fn($r) => $r['active']), 'id');
sort($active);
check('у сайта погашены мусор и закрытая, счёт верный', $gone === 2);
check('живая, чужой сайт, похожий хост и чужой источник не тронуты',
    $active === ['croc-old', 'fake-host', 'kontur-live', 'other-src']);
check('хост с символами шаблона не гасит ничего', ing_deactivate_stale('career_owner', $start, 'kontur.ru/*') === 0
    && ing_deactivate_stale('career_owner', $start, '*') === 0);

// ── Проводка: ежечасный заход не гасит и не сдвигает расписание ──────────────
$ingest = (string)file_get_contents(__DIR__ . '/../php-proxy/ingest.php');
check('заход по API не гасит', str_contains($ingest, "\$mayDeactivate = \$scope !== 'api';")
    && str_contains($ingest, 'if ($complete && $mayDeactivate) {'));
check('у захода по API своя контрольная точка',
    str_contains($ingest, "hash('sha256', (string)\$src['id'] . (\$scope !== '' ? '|' . \$scope : ''))"));
check('заход по API не проверяет и не сдвигает расписание источника',
    str_contains($ingest, "if (\$scope === '' && !\$force && !empty(\$src['last_run_at'])) {")
    && str_contains($ingest, "if (\$scope === '') sb_update('jm_ext_sources'"));
check('пометка «API ежечасно» — в конце статуса, после проверки успеха',
    preg_match("~\\\$success = str_starts_with\\(\\(string\\)\\\$res\\['status'\\], 'ок'\\);.*?\\\$res\\['status'\\] \\.= ' \\(API ежечасно\\)';~s", $ingest) === 1);
check('на неполном круге гасим сайты, прошедшие целиком',
    str_contains($ingest, 'foreach (ing_complete_hosts($unitHosts, $unitFailed) as $host) {'));
check('хосты отказавшего адреса считаются сбойными',
    str_contains($ingest, "foreach ((array)(\$f['hosts'] ?? []) as \$h) {"));

$career = (string)file_get_contents(__DIR__ . '/../php-proxy/career.php');
check('career.php в режиме API берёт только JSON и встроенное состояние',
    str_contains($career, "define('CF_ONLY_API', (\$_GET['modes'] ?? '') === 'api');")
    && str_contains($career, "in_array(\$u['kind'], ['json', 'embedded'], true)"));
check('следующая страница помнит режим API', str_contains($career, "(CF_ONLY_API ? '&modes=api' : '')"));
check('отказ адреса называет его хосты', str_contains($career, "'hosts' => array_keys(\$hosts)"));

$wf = (string)file_get_contents(__DIR__ . '/../.github/workflows/career-ingest.yml');
check('ежечасное расписание есть', str_contains($wf, "- cron: '45 * * * *'"));
check('полный круг раз в шесть часов остался', str_contains($wf, "- cron: '30 2,8,14,20 * * *'"));
check('ежечасный заход зовёт ingest со scope=api', str_contains($wf, 'URL="${URL}&scope=api"')
    && str_contains($wf, "SCOPE: \${{ (github.event.schedule == '45 * * * *'"));
check('ежечасный заход не дочитывает описания',
    str_contains($wf, "if: \${{ !(github.event.schedule == '45 * * * *' || github.event.inputs.scope == 'api') }}"));

if ($failures) {
    echo "ingest host deactivation: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "ingest host deactivation: OK\n";
