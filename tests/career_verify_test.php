<?php
// Разведка находит новые карьерные endpoint'ы, но включать их в панель без
// проверки нельзя: страница может отдавать пустой список, ссылки без
// вакансий или чужую агрегаторскую выдачу. career_verify.php проверяет их тем
// же кодом (cf_unit_from_endpoint, cf_fetch_unit), которым потом идёт сбор —
// здесь проверяется чистая часть: вердикт по вакансиям и разбор endpoint'а.
define('CAREER_VERIFY_LIB_ONLY', true); // не читать STDIN и не ходить в сеть
require_once __DIR__ . '/../php-proxy/career_verify.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function vacancy(string $title, string $url): array
{
    return ['id' => substr(hash('sha256', $url), 0, 8), 'title' => $title, 'kind' => 'permanent',
        'url' => $url, 'active' => true];
}

// ── cv_verdict ────────────────────────────────────────────────────────────────

$three = [
    vacancy('Кладовщик', 'https://career.example.ru/v/1'),
    vacancy('Комплектовщик', 'https://career.example.ru/v/2'),
    vacancy('Упаковщик', 'https://career.example.ru/v/3'),
];
$v3 = cv_verdict($three, null);
check('три нормальные вакансии — ok', $v3['ok'] === true);
check('счётчик верный при трёх вакансиях', $v3['count'] === 3);

$two = [
    vacancy('Кладовщик', 'https://career.example.ru/v/1'),
    vacancy('Комплектовщик', 'https://career.example.ru/v/2'),
];
$v2 = cv_verdict($two, null);
check('две вакансии — не ok', $v2['ok'] === false);
check('счётчик верный при двух вакансиях', $v2['count'] === 2);

$withAggregator = [
    vacancy('Кладовщик', 'https://career.example.ru/v/1'),
    vacancy('Комплектовщик', 'https://career.example.ru/v/2'),
    vacancy('Продавец', 'https://spb.hh.ru/vacancy/12345'),
];
$vAgg = cv_verdict($withAggregator, null);
check('ссылка на поддомен hh.ru — не ok', $vAgg['ok'] === false);
check('причина упоминает агрегатор', str_contains($vAgg['reason'], 'агрегатор'));

$vErr = cv_verdict([], 'страница недоступна (500 )');
check('ошибка похода — не ok', $vErr['ok'] === false);
check('причина ошибки переносится как есть', $vErr['reason'] === 'страница недоступна (500 )');

// ── career_verify.php закрыт от веба ────────────────────────────────────────
$source = (string)file_get_contents(__DIR__ . '/../php-proxy/career_verify.php');
check('точка входа закрыта для не-CLI',
    str_contains($source, "if (PHP_SAPI !== 'cli') {"));

// ── cf_unit_from_endpoint: те же режимы, что разбирает career.php ───────────

$json = cf_unit_from_endpoint(['url' => 'https://a.ru/api/vacancy', 'mode' => 'json',
    'map' => ['list' => 'items', 'title' => 'title']]);
check('json: kind распознан', ($json['kind'] ?? '') === 'json');
check('json: карта полей сохранена', ($json['map']['list'] ?? '') === 'items');
check('json: по умолчанию GET', ($json['post'] ?? true) === false);

$links = cf_unit_from_endpoint(['url' => 'https://a.ru/vacancies', 'mode' => 'html_links',
    'map' => ['link_path' => '/vacancy/']]);
check('html_links: kind распознан', ($links['kind'] ?? '') === 'html_links');

$embedded = cf_unit_from_endpoint(['url' => 'https://a.ru/careers', 'mode' => 'embedded']);
check('embedded: kind распознан', ($embedded['kind'] ?? '') === 'embedded');

$post = cf_unit_from_endpoint(['url' => 'https://metro.ru/api', 'mode' => 'json',
    'method' => 'POST', 'body' => ['lang' => 'ru']]);
check('POST: флаг post взведён', ($post['post'] ?? false) === true);
check('POST: тело сериализовано в JSON', ($post['body'] ?? '') === json_encode(['lang' => 'ru'], JSON_UNESCAPED_UNICODE));

$noUrl = cf_unit_from_endpoint(['mode' => 'json']);
check('endpoint без адреса отброшен', $noUrl === null);

if ($failures) {
    fwrite(STDERR, "career verify: ПРОВАЛЫ\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "career verify: ok; endpoint проверяется тем же кодом, что идёт на сбор\n";
