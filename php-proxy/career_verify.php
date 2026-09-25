<?php
// Проверка endpoint'а карьерного источника ДО его включения в панели.
//
// Разведка на сервере (scripts/career-discover*.mjs) находит новые адреса, но
// найти — не значит, что оттуда можно брать вакансии: страница может отдавать
// список без ссылок, форму подписки или чужую агрегаторскую выдачу. Проверять
// это нужно ровно тем кодом, которым потом идёт сбор, — иначе поход и проверка
// расходятся, и «проверено» перестаёт означать «сработает». Поэтому здесь
// вызывается cf_unit_from_endpoint и cf_fetch_unit из career_unit.php, а не
// повторяется своя копия похода и разбора.
//
// Только CLI: каталог php-proxy публикуется как /api/, и веб-доступа к
// разведочному инструменту быть не должно — он не рассчитан на чужой ввод.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/career_unit.php';

// Хосты-агрегаторы, чьи вакансии мы не перепечатываем: решение владельца — с
// hh не работаем (см. CLAUDE.md). Ссылка на них хотя бы в одной вакансии
// отклоняет endpoint целиком — значит источник сам ссылается на агрегатор, а
// не публикует вакансию у себя.
const CV_AGGREGATOR_HOSTS = [
    'hh.ru', 'headhunter.ru', 'superjob.ru', 'zarplata.ru', 'rabota.ru', 'avito.ru',
];

function cv_is_aggregator_host(string $host): bool
{
    $host = strtolower($host);
    foreach (CV_AGGREGATOR_HOSTS as $agg) {
        if ($host === $agg || str_ends_with($host, '.' . $agg)) return true;
    }
    return false;
}

/**
 * Чистая функция без сети: вердикт по уже полученным вакансиям.
 *
 * ok=true только когда похода не было ошибки, принято не меньше 3 вакансий, и
 * ни одна из них не ведёт на агрегатор. У каждой принятой вакансии обязаны
 * быть непустое название и https-ссылка — то же правило, что уже применяет
 * cf_normalize/cf_json_items, но проверяется здесь ещё раз: разведка должна
 * доверять не источнику, а собственной проверке.
 */
function cv_verdict(array $items, ?string $error): array
{
    if ($error !== null) return ['ok' => false, 'count' => 0, 'reason' => $error];

    $accepted = 0;
    foreach ($items as $item) {
        $title = trim((string)($item['title'] ?? ''));
        $url = trim((string)($item['url'] ?? ''));
        if ($title === '' || !preg_match('~^https://~i', $url)) continue;

        $host = (string)(parse_url($url, PHP_URL_HOST) ?? '');
        if ($host !== '' && cv_is_aggregator_host($host)) {
            return ['ok' => false, 'count' => 0, 'reason' => 'ссылки ведут на агрегатор'];
        }
        $accepted++;
    }
    if ($accepted < 3) {
        return ['ok' => false, 'count' => $accepted, 'reason' => 'меньше 3 принятых вакансий'];
    }
    return ['ok' => true, 'count' => $accepted, 'reason' => ''];
}

/** Один endpoint: строим юнит, проверяем адрес, ходим тем же кодом, что и сбор. */
function cv_check_endpoint(array $endpoint): array
{
    $unit = cf_unit_from_endpoint($endpoint);
    if ($unit === null) {
        return ['url' => (string)($endpoint['url'] ?? ''),
            'verdict' => ['ok' => false, 'count' => 0, 'reason' => 'endpoint без адреса']];
    }
    if (!ing_safe_https_url($unit['url'])) {
        return ['url' => $unit['url'],
            'verdict' => ['ok' => false, 'count' => 0, 'reason' => 'адрес не проходит проверку']];
    }
    $fetched = cf_fetch_unit($unit, 0);
    return ['url' => $unit['url'], 'verdict' => cv_verdict($fetched['items'], $fetched['error'])];
}

// ── Точка входа ───────────────────────────────────────────────────────────────
// Отделена константой, чтобы тест мог взять отсюда cv_verdict и
// cv_check_endpoint, не запуская сеть и не блокируясь на чтении STDIN —
// тот же приём, что в landing_page.php и vacancy_page.php.
if (defined('CAREER_VERIFY_LIB_ONLY')) return;

$stdin = stream_get_contents(STDIN);
$rows = json_decode((string)$stdin, true);
$rows = is_array($rows) ? $rows : [];

$out = [];
foreach ($rows as $i => $row) {
    // Пауза между чужими сайтами, а не перед первым запросом.
    if ($i > 0) sleep(1);
    if (!is_array($row)) continue;
    $company = (string)($row['company'] ?? '');
    $endpoint = is_array($row['endpoint'] ?? null) ? $row['endpoint'] : [];
    $checked = cv_check_endpoint($endpoint);
    $out[] = [
        'company' => $company,
        'url' => $checked['url'],
        'ok' => $checked['verdict']['ok'],
        'count' => $checked['verdict']['count'],
        'reason' => $checked['verdict']['reason'],
    ];
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
exit(0);
