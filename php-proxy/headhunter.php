<?php
// Публичный поиск вакансий hh.ru → общий формат фида JobToo.

@ini_set('display_errors', '0');
@set_time_limit(120);
header('Content-Type: application/json; charset=utf-8');

function hh_cfg(string $name, string $default): string {
    static $file = null;
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);
    if ($file === null) {
        $values = is_readable(__DIR__ . '/app_secrets.php') ? @include __DIR__ . '/app_secrets.php' : null;
        $file = is_array($values) ? $values : [];
    }
    $value = (string)($file[$name] ?? '');
    return $value !== '' ? $value : $default;
}

$apiBase = rtrim(hh_cfg('HH_API_BASE', 'https://api.hh.ru'), '/');
$selfUrl = hh_cfg('HH_SELF_URL', 'https://jobtoo.ru/api/headhunter.php');
$userAgent = hh_cfg('HH_USER_AGENT', 'JobToo/1.0 (support@jobtoo.ru)');
$area = max(1, (int)hh_cfg('HH_AREA_ID', '1')); // 1 — Москва
$page = max(0, (int)($_GET['page'] ?? 0));
$limit = 100;
$url = $apiBase . '/vacancies?' . http_build_query([
    'area' => $area, 'page' => $page, 'per_page' => $limit,
    'order_by' => 'publication_time',
], '', '&', PHP_QUERY_RFC3986);

$body = '';
$tooLarge = false;
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'HH-User-Agent: ' . $userAgent],
    CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 45,
    CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooLarge): int {
        if (strlen($body) + strlen($chunk) > 8 * 1024 * 1024) {
            $tooLarge = true; return 0;
        }
        $body .= $chunk; return strlen($chunk);
    },
]);
$ok = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);
if ($tooLarge || $ok === false || $code < 200 || $code >= 300) {
    http_response_code(502);
    echo json_encode(['error' => $tooLarge ? 'hh response too large' : "hh unavailable ($code $error)"]);
    exit;
}
$decoded = json_decode($body, true);
if (!is_array($decoded) || !is_array($decoded['items'] ?? null)) {
    http_response_code(502); echo json_encode(['error' => 'hh invalid JSON']); exit;
}

function hh_text($value): string {
    $text = html_entity_decode(strip_tags((string)$value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim(preg_replace('~\s+~u', ' ', $text));
}

$items = [];
foreach ($decoded['items'] as $vacancy) {
    if (!is_array($vacancy)) continue;
    $id = trim((string)($vacancy['id'] ?? ''));
    $title = trim((string)($vacancy['name'] ?? ''));
    $link = trim((string)($vacancy['alternate_url'] ?? ''));
    if ($id === '' || $title === '' || !preg_match('~^https://(?:[^/]+\.)?hh\.ru/vacancy/~i', $link)) continue;

    $snippet = is_array($vacancy['snippet'] ?? null) ? $vacancy['snippet'] : [];
    $description = implode("\n\n", array_filter([
        hh_text($snippet['requirement'] ?? ''), hh_text($snippet['responsibility'] ?? ''),
    ]));
    $salaryData = is_array($vacancy['salary'] ?? null) ? $vacancy['salary'] : [];
    $salaryFrom = is_numeric($salaryData['from'] ?? null) ? (float)$salaryData['from'] : 0;
    $salaryTo = is_numeric($salaryData['to'] ?? null) ? (float)$salaryData['to'] : 0;
    $salary = $salaryFrom > 0 ? $salaryFrom : $salaryTo;
    $schedule = is_array($vacancy['schedule'] ?? null) ? trim((string)($vacancy['schedule']['name'] ?? '')) : '';
    $employment = is_array($vacancy['employment'] ?? null) ? trim((string)($vacancy['employment']['name'] ?? '')) : '';
    $scheduleText = implode(' · ', array_filter([$schedule, $employment]));
    $addressData = is_array($vacancy['address'] ?? null) ? $vacancy['address'] : [];
    $address = trim((string)($addressData['raw'] ?? ''));
    $metro = is_array($addressData['metro'] ?? null) ? trim((string)($addressData['metro']['station_name'] ?? '')) : '';
    $company = is_array($vacancy['employer'] ?? null) ? trim((string)($vacancy['employer']['name'] ?? '')) : '';

    $item = [
        'id' => $id, 'title' => $title, 'kind' => 'permanent',
        'url' => $link, 'active' => true, 'pay_period' => 'month',
    ];
    if ($company !== '') $item['company'] = $company;
    if ($address !== '') $item['address'] = $address;
    // Ключ именно 'metro': ingest.php читает его, а не 'metro_station'.
    // Ошибка в имени ничего не ломает вслух — станция просто пропадает.
    if ($metro !== '') $item['metro'] = $metro;
    if ($salary > 0) $item['pay'] = $salary;
    if ($scheduleText !== '') $item['schedule'] = $scheduleText;
    if ($description !== '') $item['description'] = $description;
    $items[] = $item;
}

$pages = max(0, (int)($decoded['pages'] ?? 0));
$hasMore = $page + 1 < $pages;
$out = ['items' => $items, 'has_more' => $hasMore, 'page' => $page,
    'total' => isset($decoded['found']) ? (int)$decoded['found'] : null];
if ($hasMore) $out['next_url'] = $selfUrl . '?page=' . ($page + 1);
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
