<?php
// Регрессии для источников, подключённых 2026-09-16.
// Здесь проверяется именно форма прямой ссылки работодателя: разделы и шум
// не должны превращаться в вакансии, а Next.js state должен отдавать все rows.

require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function source_check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$now = 1_789_570_000;

$kasperskyHtml = <<<'HTML'
<html><body>
<a href="/vacancy/25878">DevOps инженер Linux (KasperskyOS Infrastructure)</a>
<a href="/vacancy/25341">Senior System Analyst</a>
<a href="/vacancies">Все вакансии</a>
<a href="/vacancy/jobtoo-probe-404">Не вакансия</a>
</body></html>
HTML;
$kasperskyMap = [
    'link_path' => '/vacancy/',
    'link_regex' => '~^/vacancy/[0-9]+/?(?:\\?.*)?$~',
    'company_const' => 'Kaspersky',
    'min_title' => 8,
];
$items = cf_html_links($kasperskyHtml, 'https://careers.kaspersky.com/vacancies?page=0', $kasperskyMap, $now);
source_check('Kaspersky: только числовые карточки', count($items) === 2);
source_check('Kaspersky: прямой employer URL', ($items[0]['url'] ?? '') === 'https://careers.kaspersky.com/vacancy/25878');
source_check('Kaspersky: компания нормализована', ($items[0]['company'] ?? '') === 'Kaspersky');
source_check('Kaspersky: нулевая пагинация',
    cf_page_url('https://careers.kaspersky.com/vacancies?page=0',
        ['type' => 'page', 'param' => 'page', 'start' => 0, 'limit' => 14], 3)
    === 'https://careers.kaspersky.com/vacancies?page=3');

$selectelHtml = <<<'HTML'
<html><body>
<a href="/careers/all/vacancy/1918/">Системный администратор Linux</a>
<a href="/careers/all/vacancy/1947/">Инженер технической поддержки</a>
<a href="/careers/all/">Все вакансии</a>
<a href="/careers/all/vacancy/platform/">Направление</a>
</body></html>
HTML;
$selectelMap = [
    'link_path' => '/careers/all/vacancy/',
    'link_regex' => '~^/careers/all/vacancy/[0-9]+/?$~',
    'company_const' => 'Селектел',
    'min_title' => 8,
];
$items = cf_html_links($selectelHtml, 'https://selectel.ru/careers/all', $selectelMap, $now);
source_check('Селектел: только карточки вакансий', count($items) === 2);
source_check('Селектел: прямой employer URL', ($items[0]['url'] ?? '') === 'https://selectel.ru/careers/all/vacancy/1918/');
source_check('Селектел: компания нормализована', ($items[0]['company'] ?? '') === 'Селектел');

$koronaState = [
    'props' => ['pageProps' => ['blocks' => [[
        'data' => ['vacancies' => [
            [
                'id' => '295',
                'attributes' => [
                    'title' => 'Инженер по системному сопровождению',
                    'city' => ['data' => ['attributes' => ['name' => 'Удаленно']]],
                ],
            ],
            [
                'id' => '294',
                'attributes' => [
                    'title' => 'Инженер по безопасной разработке ПО',
                    'city' => ['data' => ['attributes' => ['name' => 'Томск']]],
                ],
            ],
        ]],
    ]]]],
];
$koronaHtml = '<html><body><script id="__NEXT_DATA__" type="application/json">'
    . json_encode($koronaState, JSON_UNESCAPED_UNICODE)
    . '</script></body></html>';
$state = cf_embedded_state($koronaHtml);
source_check('Koronatech: Next.js state прочитан', is_array($state));
$koronaMap = [
    'list' => 'props.pageProps.blocks.0.data.vacancies',
    'title' => 'attributes.title',
    'id' => 'id',
    'address' => 'attributes.city.data.attributes.name',
    'company_const' => 'Koronatech',
    'url_template' => 'https://koronatech.ru/vacancy/{id}/',
];
$items = cf_json_items($state, $koronaMap, 'https://koronatech.ru/vacancy/', $now);
source_check('Koronatech: вложенный список разобран полностью', count($items) === 2);
source_check('Koronatech: URL построен из id', ($items[0]['url'] ?? '') === 'https://koronatech.ru/vacancy/295/');
source_check('Koronatech: город сохранён', ($items[0]['address'] ?? '') === 'Удаленно');
source_check('Koronatech: компания нормализована', ($items[0]['company'] ?? '') === 'Koronatech');

// У Сбера publicationId — UUID, но живой URL карточки строится из internalId.
// /search/vacancy-4570914/ проверен браузером: 200 и redirect на slug той же
// вакансии «SQL разработчик», поэтому старый /vacancy/{publicationId} не нужен.
$sberData = [
    'data' => [
        'vacancies' => [[
            'internalId' => 4570914,
            'publicationId' => '4b402da8-9ccf-4a36-a6a2-9ea970db5cda',
            'title' => 'SQL разработчик',
            'city' => 'г Екатеринбург',
            'company' => 'ПАО Сбербанк',
            'introduction' => 'Ищем опытного специалиста баз данных',
            'salary_min' => 180000,
        ]],
    ],
];
$sberMap = [
    'list' => 'data.vacancies',
    'title' => 'title',
    'id' => 'internalId',
    'address' => 'city',
    'description' => 'introduction',
    'pay' => 'salary_min',
    'company_const' => 'Сбер',
    'url_template' => 'https://rabota.sber.ru/search/vacancy-{internalId}/',
];
$items = cf_json_items($sberData, $sberMap, 'https://rabota.sber.ru/search', $now);
source_check('Сбер: JSON-вакансия разобрана', count($items) === 1);
source_check('Сбер: internalId используется как внешний id', ($items[0]['id'] ?? '') === '4570914');
source_check('Сбер: прямой employer URL построен из internalId',
    ($items[0]['url'] ?? '') === 'https://rabota.sber.ru/search/vacancy-4570914/');
source_check('Сбер: компания канонична', ($items[0]['company'] ?? '') === 'Сбер');
source_check('Сбер: город сохранён', ($items[0]['address'] ?? '') === 'г Екатеринбург');
source_check('Сбер: зарплата сохранена', ($items[0]['pay'] ?? 0) === 180000.0);
source_check('Сбер: offset-пагинация до 3500+',
    cf_page_url(
        'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications',
        ['type' => 'offset', 'param' => 'skip', 'limit_param' => 'take', 'limit' => 100, 'max_pages' => 50],
        34
    ) === 'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications?take=100&skip=3400');

if ($failures) {
    fwrite(STDERR, "FAIL:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "OK: новые career-источники и прямые ссылки разобраны корректно\n";
