<?php
require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function sber_check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$now = 1_789_570_000;
$payload = [
    'data' => [
        'vacancies' => [
            [
                'internalId' => 4570914,
                'title' => 'SQL разработчик',
                'city' => 'г Екатеринбург',
                'introduction' => 'Продуктовая команда Сбера',
                'salary_min' => null,
            ],
            [
                'internalId' => 4567299,
                'title' => 'Руководитель направления',
                'city' => 'г Москва',
                'introduction' => 'Команда финансовой отчётности',
                'salary_min' => 150000,
            ],
        ],
        'total' => 3466,
    ],
    'success' => true,
];

$map = [
    'list' => 'data.vacancies',
    'title' => 'title',
    'id' => 'internalId',
    'address' => 'city',
    'description' => 'introduction',
    'pay' => 'salary_min',
    'company_const' => 'Сбер',
    'url_template' => 'https://rabota.sber.ru/search/vacancy-{internalId}/',
];

$items = cf_json_items(
    $payload,
    $map,
    'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications?take=100&skip=0',
    $now
);

sber_check('Сбер: обе записи официального API разобраны', count($items) === 2);
sber_check('Сбер: internalId сохраняется как id', (string)($items[0]['id'] ?? '') === '4570914');
sber_check('Сбер: прямой URL конкретной вакансии',
    ($items[0]['url'] ?? '') === 'https://rabota.sber.ru/search/vacancy-4570914/');
sber_check('Сбер: компания канонична', ($items[0]['company'] ?? '') === 'Сбер');
sber_check('Сбер: город сохранён', ($items[0]['address'] ?? '') === 'г Екатеринбург');
sber_check('Сбер: описание сохранено', ($items[0]['description'] ?? '') === 'Продуктовая команда Сбера');
sber_check('Сбер: отсутствующая зарплата не выдумана', !array_key_exists('pay', $items[0]));
sber_check('Сбер: открытая зарплата сохраняется', (float)($items[1]['pay'] ?? 0) === 150000.0);

$paging = [
    'type' => 'offset',
    'param' => 'skip',
    'limit_param' => 'take',
    'limit' => 100,
    'max_pages' => 50,
];
$p2 = cf_page_url(
    'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications',
    $paging,
    2
);
sber_check('Сбер: offset пагинация строит третий пакет',
    $p2 === 'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications?take=100&skip=200');

$migration = file_get_contents(__DIR__ . '/../supabase/migrations/095_sber_restore_official_api.sql');
sber_check('095: latest migration возвращает официальный API работодателя',
    is_string($migration)
    && str_contains($migration, 'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications'));
sber_check('095: latest migration строит конкретную employer vacancy URL',
    is_string($migration)
    && str_contains($migration, 'https://rabota.sber.ru/search/vacancy-{internalId}/'));
sber_check('095: Developers fallback больше не является production endpoint',
    is_string($migration)
    && !str_contains($migration, "'url', 'https://developers.sber.ru/kak-v-sbere/vacancies'"));

if ($failures) {
    fwrite(STDERR, "FAIL:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "OK: Сбер использует прямой официальный API и прямые employer vacancy URL\n";
