<?php
// Карьерный коннектор читает не только разметку, но и собственный JSON сайта.
//
// Почему это понадобилось. Разметку schema.org/JobPosting ставят почти одни
// IT-компании: из восемнадцати проверенных карьерных сайтов — Сбер, МТС,
// Яндекс, Ozon, ВТБ, VK, Т-Банк, Самокат, X5, Магнит, ВкусВилл и другие — её
// нет ни у одного. Зато почти все они SPA, а за SPA всегда стоит источник
// данных, отдающий готовый JSON.
//
// Соответствие полей описывает настройка источника, а не код: у каждого сайта
// свои имена. Один разбор на всех — вместо парсера под каждый сайт, на чём у
// cofinder из 111 российских источников сломаны 15.
define('LANDING_PAGE_LIB_ONLY', true); // на случай, если файл потянет соседей
require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function check(string $name, bool $ok): void {
    global $failures;
    if (!$ok) $failures[] = $name;
}

$now = time();

// ── Формат карьерных сайтов на Хантфлоу ──────────────────────────────────────
// Взят с живого ответа https://opportunities.huntflow.io/api/vacancy:
// список лежит в items, ссылки на вакансию в ответе нет — она собирается из
// slug, поэтому здесь проверяется именно шаблон адреса.
$huntflow = ['total' => 1, 'page' => 1, 'items' => [
    ['id' => 20009, 'slug' => 'go-3', 'position' => 'Golang Dev',
     'money' => null, 'division' => 'Техи', 'city' => 'Москва', 'archived_at' => null],
    ['id' => 20010, 'slug' => 'php-dev-2', 'position' => 'PHP разработчик',
     'money' => 'от 250 000 ₽', 'division' => 'Техи', 'city' => null, 'archived_at' => null],
    // Закрытая: не должна попасть в выдачу.
    ['id' => 20011, 'slug' => 'old', 'position' => 'Закрытая',
     'money' => null, 'city' => null, 'archived_at' => '2026-01-01'],
]];
$map = [
    'list' => 'items', 'title' => 'position', 'id' => 'id',
    'url_template' => 'https://opportunities.huntflow.io/vacancy/{slug}',
    'address' => 'city', 'pay' => 'money', 'closed' => 'archived_at',
];
$items = cf_json_items($huntflow, $map, 'https://opportunities.huntflow.io/', $now);

check('прочитаны обе открытые вакансии', count($items) === 2);
check('название взято из своего поля', ($items[0]['title'] ?? '') === 'Golang Dev');
check('ссылка собрана по шаблону из slug',
    ($items[0]['url'] ?? '') === 'https://opportunities.huntflow.io/vacancy/go-3');
check('раздел «Работа», а не смены', ($items[0]['kind'] ?? '') === 'permanent');
check('город лёг в адрес', ($items[0]['address'] ?? '') === 'Москва');
check('закрытая вакансия отброшена',
    !in_array('Закрытая', array_column($items, 'title'), true));
check('сумма вытащена из строки «от 250 000 ₽»', ($items[1]['pay'] ?? null) === 250000.0);
check('пустая сумма не выдумана', !array_key_exists('pay', $items[0]));

// ── Формат с готовой ссылкой и вложенным списком ─────────────────────────────
// Так устроен ответ cofinder: /api/v1/vacancies/ отдаёт items с полем url,
// указывающим прямо на карьерный сайт работодателя.
$plain = ['data' => ['rows' => [
    ['jobId' => 'a1', 'name' => 'Data Engineer', 'link' => 'https://career.example.ru/v/1',
     'org' => 'Aston', 'salary' => 300000],
]]];
$items2 = cf_json_items($plain, [
    'list' => 'data.rows', 'title' => 'name', 'id' => 'jobId',
    'url' => 'link', 'company' => 'org', 'pay' => 'salary',
], 'https://career.example.ru/', $now);
check('путь к списку через точку работает', count($items2) === 1);
check('готовая ссылка взята как есть', ($items2[0]['url'] ?? '') === 'https://career.example.ru/v/1');
check('компания прочитана', ($items2[0]['company'] ?? '') === 'Aston');
check('числовая сумма прочитана', ($items2[0]['pay'] ?? null) === 300000.0);

// ── Без ссылки вакансию не берём ─────────────────────────────────────────────
// Правило то же, что и для разметки, и оно не обсуждается: перепечатка чужой
// вакансии без пути к первоисточнику — это то, что делает swipejobs.
$noUrl = ['items' => [['name' => 'Без ссылки']]];
check('без ссылки вакансия не берётся',
    cf_json_items($noUrl, ['list' => 'items', 'title' => 'name'], 'https://example.ru/', $now) === []);

// Относительный адрес достраивается от страницы источника.
$rel = ['items' => [['name' => 'Относительная', 'url' => '/vacancy/7']]];
$items3 = cf_json_items($rel, ['list' => 'items', 'title' => 'name'], 'https://job.example.ru/list', $now);
check('относительный адрес достроен',
    ($items3[0]['url'] ?? '') === 'https://job.example.ru/vacancy/7');

// ── Мусор не роняет разбор ───────────────────────────────────────────────────
check('нет списка — пустой результат',
    cf_json_items(['x' => 1], ['list' => 'items', 'title' => 'name'], 'https://e.ru/', $now) === []);
check('строки не массивы — пропускаются',
    cf_json_items(['items' => ['строка', 42]], ['list' => 'items', 'title' => 'name'], 'https://e.ru/', $now) === []);
check('вакансия без названия пропускается',
    cf_json_items(['items' => [['url' => 'https://e.ru/v/1']]], ['list' => 'items', 'title' => 'name'], 'https://e.ru/', $now) === []);

// ── Разметка по-прежнему читается ────────────────────────────────────────────
// Новый путь не должен сломать старый.
$html = '<script type="application/ld+json">' . json_encode([
    '@type' => 'JobPosting', 'title' => 'Комплектовщик',
    'url' => 'https://example.ru/v/9',
    'hiringOrganization' => ['@type' => 'Organization', 'name' => 'Склад'],
]) . '</script>';
$fromHtml = cf_items($html, 'https://example.ru/', $now);
check('разметка JobPosting читается как раньше',
    count($fromHtml) === 1 && ($fromHtml[0]['title'] ?? '') === 'Комплектовщик');

if ($failures) {
    fwrite(STDERR, "career json: ПРОВАЛЫ\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}
echo "career json: ok; коннектор читает JSON карьерных сайтов\n";
