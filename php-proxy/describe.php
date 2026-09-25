<?php
// Дозагрузка полного описания вакансии со страницы.
//
// ingest.php кладёт в description короткий анонс из списка (у четверти
// вакансий его вообще нет) и перезаписывает эту колонку на каждом заходе —
// сходить за полным разбором страницы (vacancy_text.php, vt_extract) там же
// значило бы не уложиться в бюджет обхода на сотнях работодателей. Поэтому
// описание со структурой копится отдельным проходом, в свою колонку
// (миграция 117), которую ingest не трогает.
//
// Зовёт .github/workflows/career-ingest.yml в цикле после самого ingest.php,
// пока очередь не опустеет — см. поле remaining в ответе.

@ini_set('display_errors', '0');
@set_time_limit(120);
header('Content-Type: application/json; charset=utf-8');

// Библиотечный режим отключает в ingest.php и проверку токена, и сам заход
// за фидами (см. финальный `if (!defined('INGEST_LIBRARY_ONLY'))` там) —
// нужны только его функции: ing_fetch_html с СЗЗУ-сторожами и ing_secret.
define('INGEST_LIBRARY_ONLY', true);
require_once __DIR__ . '/ingest.php';
require_once __DIR__ . '/vacancy_text.php';

/** Тот же токен и та же проверка, что в ingest.php — своя копия, потому что
 *  INGEST_LIBRARY_ONLY выключает проверку внутри ingest.php целиком. */
function ds_check_admin(): void
{
    $expected = ing_secret('ADMIN_API_TOKEN');
    if ($expected === '') {
        $credFile = __DIR__ . '/admin_credentials.php';
        $creds = is_readable($credFile) ? @include $credFile : null;
        $expected = is_array($creds) ? (string)($creds['password'] ?? '') : '';
    }
    $given = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($expected === '' || !hash_equals($expected, $given)) {
        http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
    }
}

const DS_BATCH = 300;
const DS_BUDGET_SEC = 75.0;
const DS_STALE_DAYS = 30;
const DS_MIN_TEXT_LEN = 120;
// Вежливость: одному хосту — не чаще раза в секунду. Дозагрузка идёт по
// сотням вакансий одного работодателя подряд (сортировка по свежести), и без
// паузы это выглядело бы как самим же нами устроенная атака на чужой сайт.
const DS_MIN_GAP_SEC = 1.0;

/** Условие очереди: активная вакансия без описания или с устаревшим. */
function ds_queue_condition(int $now, int $staleDays = DS_STALE_DAYS): array
{
    $cutoff = gmdate('Y-m-d\TH:i:s\Z', $now - $staleDays * 86400);
    return [
        'active' => 'is.true',
        'or' => "(described_at.is.null,described_at.lt.{$cutoff})",
    ];
}

/** Та же очередь, но пачкой и в порядке «свежие сначала» — для самой выборки. */
function ds_queue_filter(int $now, int $staleDays = DS_STALE_DAYS): array
{
    return array_merge(ds_queue_condition($now, $staleDays), [
        'order' => 'first_seen_at.desc',
        'limit' => (string)DS_BATCH,
    ]);
}

/**
 * Сколько секунд подождать перед следующим запросом к $host. Не спит сама —
 * это отдельная чистая функция ровно затем, чтобы троттлер можно было
 * проверить тестом без секундомера.
 */
function ds_throttle_wait(array $lastAt, string $host, float $now, float $minGap = DS_MIN_GAP_SEC): float
{
    $prev = $lastAt[$host] ?? null;
    if ($prev === null) return 0.0;
    $wait = $minGap - ($now - $prev);
    return $wait > 0 ? $wait : 0.0;
}

/** Что писать в description_full по содержимому страницы (или его отсутствию). */
function ds_describe_html(?string $html, int $minLen = DS_MIN_TEXT_LEN): ?string
{
    if ($html === null) return null;
    $text = vt_extract($html);
    return mb_strlen($text) >= $minLen ? $text : null;
}

// Тот же приём, что в ingest.php: DESCRIBE_LIBRARY_ONLY даёт tests/describe_test.php
// подключить файл ради чистых функций выше, не трогая ни токен, ни сеть, ни базу.
if (!defined('DESCRIBE_LIBRARY_ONLY')) {
ds_check_admin();

$deadline = microtime(true) + DS_BUDGET_SEC;
$rows = sb_select('jm_ext_vacancies', ds_queue_filter(time()), 'id,url');

$described = 0;
$attempted = 0;
$lastAt = [];
foreach ($rows as $row) {
    if (microtime(true) >= $deadline) break;
    $url = (string)($row['url'] ?? '');
    $host = strtolower((string)(parse_url($url, PHP_URL_HOST) ?: ''));

    if ($host !== '') {
        $wait = ds_throttle_wait($lastAt, $host, microtime(true));
        if ($wait > 0) usleep((int)round($wait * 1_000_000));
    }
    $html = ing_fetch_html($url);
    if ($host !== '') $lastAt[$host] = microtime(true);
    $attempted++;
    $text = ds_describe_html($html);

    // described_at ставим и на неудаче: иначе одна и та же нерабочая
    // страница долбилась бы заново на каждом заходе, съедая бюджет тех, что
    // ещё можно дочитать.
    sb_update('jm_ext_vacancies', ['id' => 'eq.' . $row['id']], [
        'description_full' => $text,
        'described_at' => now_iso(),
    ]);
    if ($text !== null) $described++;
}

$remaining = count(sb_select('jm_ext_vacancies', ds_queue_condition(time()), 'id'));

echo json_encode(['described' => $described, 'attempted' => $attempted, 'remaining' => $remaining]);
}
