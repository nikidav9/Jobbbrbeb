<?php
// Открытые счётчики ленты: считают правильно и не несут ничего, кроме чисел
// и названий компаний.

define('FEED_STATS_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/feed_stats.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$s = fs_aggregate([
    ['company' => 'Яндекс', 'section' => 'it'],
    ['company' => 'Яндекс', 'section' => 'it'],
    ['company' => 'Сбер', 'section' => 'sales'],
    ['company' => 'Сбер', 'section' => 'it'],
    ['company' => 'Магнит', 'section' => 'retail'],
    ['company' => '', 'section' => null],
], '2026-09-26T06:00:00Z');

check('всего', $s['total'] === 6);
check('IT всего', $s['it_total'] === 3);
check('компаний', $s['companies'] === 4);
check('компаний с IT', $s['it_companies'] === 2);
check('раздел без метки — other', ($s['by_section']['other'] ?? 0) === 1);
check('первым идёт больше всего IT', $s['by_company'][0] === ['company' => 'Яндекс', 'total' => 2, 'it' => 2]);
check('у Сбера посчитаны и все, и IT', in_array(['company' => 'Сбер', 'total' => 2, 'it' => 1], $s['by_company'], true));
check('лента IT: раздел it плюс IT-компания целиком',
    fs_aggregate([['company' => 'Яндекс', 'section' => 'marketing'], ['company' => 'Сбер', 'section' => 'it'],
                  ['company' => 'Сбер', 'section' => 'sales']], 'x', ['Яндекс'])['it_feed_total'] === 2);
check('пустая таблица', fs_aggregate([], 'x')['total'] === 0 && fs_aggregate([], 'x')['it_total'] === 0);

check('в ленту по Москве не идут другие города',
    fs_aggregate([['company' => 'VK', 'section' => 'it', 'address' => 'Санкт-Петербург'],
                  ['company' => 'VK', 'section' => 'it', 'address' => 'Москва'],
                  ['company' => 'VK', 'section' => 'it', 'address' => null],
                  ['company' => 'VK', 'section' => 'it', 'address' => 'Удалённо'],
                  ['company' => 'VK', 'section' => 'it', 'address' => 'Минск', 'metro_station_norm' => null],
                  ['company' => 'VK', 'section' => 'it', 'address' => 'ул. Ленина', 'metro_station_norm' => 'Сокол']], 'x', ['VK'])['feed_total'] === 4);
check('Томск — не Москва', !fs_is_moscow(['address' => 'Томск']));
check('«Москва, Санкт-Петербург» — Москва', fs_is_moscow(['address' => 'Санкт-Петербург, Москва']));

// Только эти столбцы из базы: ни описаний, ни ссылок, ни чего-либо о людях.
$src = (string)file_get_contents(__DIR__ . '/../php-proxy/feed_stats.php');
check('из базы берутся только company, section и место', str_contains($src, "], 'company,section,address,metro_station_norm');")
    && substr_count($src, 'sb_select(') === 2 && str_contains($src, "sb_select('jm_it_companies', [], 'company')"));

if ($failures) {
    echo "feed stats: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "feed stats: OK\n";
