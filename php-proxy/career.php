<?php
// Карьерные страницы работодателей → общий формат фида JobToo.
//
// Читает адреса из connector_config источника, ходит по одному за запрос и
// отдаёт вакансии в том же виде, что headhunter.php и arbihunter.php: ingest.php
// не знает, откуда они, и знать не должен.
//
// Ходим по одной странице за вызов и возвращаем next_url: ingest уже умеет
// листать, а карьерная страница отвечает медленнее API — десяток подряд не
// уложится в отведённое время.

@ini_set('display_errors', '0');
@set_time_limit(120);
header('Content-Type: application/json; charset=utf-8');

define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/career_feed.php';
// Правило адреса берём общее с приёмником, а не пишем своё: см. safe_url.php.
require_once __DIR__ . '/safe_url.php';

// Точка входа открыта, как открыты headhunter.php и arbihunter.php: пишет в базу
// не она, а ingest.php, и он закрыт админским токеном. Отдаём мы отсюда только
// то, что и так лежит в нашей публичной выдаче, а сходить наш сервер может
// лишь по адресам, заранее записанным в панели, — произвольный адрес из
// запроса сюда не попадает. Это решение, а не недосмотр.
function cf_fail(int $code, string $message): void
{
    http_response_code($code);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$sourceId = trim((string)($_GET['source'] ?? ''));
if ($sourceId === '' || !preg_match('~^[A-Za-z0-9._-]{1,64}$~', $sourceId)) {
    cf_fail(400, 'нет источника');
}
$page = max(0, (int)($_GET['page'] ?? 0));
// Порция внутри одного источника. Карьерные API отдают вакансии по частям, и
// без этого мы брали бы только первую: у Сбера 50 из 1795.
$sub  = max(0, (int)($_GET['sub'] ?? 0));

$source = sb_single('jm_ext_sources', ['id' => 'eq.' . $sourceId], 'id,connector_kind,connector_config,enabled');
if (!$source || (string)($source['connector_kind'] ?? '') !== 'career') {
    cf_fail(404, 'источник не карьерные страницы');
}
// Выключенный источник не обслуживаем. Миграция 063 заводит его выключенным
// намеренно: сначала владелец смотрит глазами, что отдают страницы, и только
// потом включает. Отдавать его через открытую точку входа значило бы обойти
// эту проверку — поле enabled запрашивалось, но не проверялось.
if (empty($source['enabled'])) {
    cf_fail(403, 'источник выключен');
}

$config = is_array($source['connector_config'] ?? null) ? $source['connector_config'] : [];
// Источник бывает двух видов, и обходим мы их одним списком. `pages` — адрес
// страницы с разметкой JobPosting, `endpoints` — найденный разведкой адрес
// JSON вместе с картой полей. Второй вид разбирался в career_feed.php
// (cf_json_items), но сюда подключён не был: настройку было некуда вписать.
$units = [];
foreach (is_array($config['pages'] ?? null) ? $config['pages'] : [] as $u) {
    if (is_string($u)) $units[] = ['url' => $u, 'kind' => 'html', 'map' => [], 'paging' => []];
}
foreach (is_array($config['endpoints'] ?? null) ? $config['endpoints'] : [] as $e) {
    if (!is_array($e) || !is_string($e['url'] ?? null)) continue;
    // `mode` различает JSON API и страницу со ссылками на вакансии. Третий вид
    // появился потому, что замер по 111 карьерным сайтам показал: разметку
    // JobPosting держат двое, JSON отдают немногие, а список обычных ссылок
    // лежит у двух десятков.
    $mode = (string)($e['mode'] ?? 'json');
    $units[] = [
        'url'    => $e['url'],
        'kind'   => $mode === 'html_links' ? 'html_links' : 'json',
        'map'    => is_array($e['map'] ?? null) ? $e['map'] : [],
        'paging' => is_array($e['paging'] ?? null) ? $e['paging'] : [],
    ];
}
// Список задаёт администратор в панели. Это не повод пускать сборщик куда
// угодно: адрес всё равно проходит ту же проверку, что и адрес источника —
// только публичный HTTPS, без localhost, служебных сетей и метаданных облака.
$units = array_values(array_filter($units, fn($u) => ing_safe_https_url($u['url'])));
if (!$units) cf_fail(422, 'у источника нет годных адресов карьерных страниц');
if ($page >= count($units)) cf_fail(404, 'страница за пределами списка');

$unit = $units[$page];
// Адрес порции строим до похода, но проверяем заново: подставляются только
// числа в параметры, и всё же идти мы должны ровно по проверенному адресу.
$pageUrl = $unit['kind'] === 'html' ? $unit['url'] : cf_page_url($unit['url'], $unit['paging'], $sub);
if (!ing_safe_https_url($pageUrl)) cf_fail(422, 'адрес порции не проходит проверку');
$resolveEntries = ing_safe_https_resolve($pageUrl);
if ($resolveEntries === null) cf_fail(422, 'адрес страницы больше не разрешается безопасно');

$body = '';
$tooLarge = false;
$ch = curl_init($pageUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HTTPHEADER => [$unit['kind'] === 'json'
        ? 'Accept: application/json'
        : 'Accept: text/html,application/xhtml+xml'],
    // Часть сайтов без Accept-Language отдаёт англоязычную версию, а нам нужны
    // русские названия должностей.
    CURLOPT_ENCODING => '',
    CURLOPT_USERAGENT => 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)',
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 45,
    // Переход по редиректу увёл бы нас на адрес, который проверку не проходил:
    // так обходят запрет на служебные сети.
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_RESOLVE => $resolveEntries,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooLarge): int {
        // Карьерная страница — это текст. Четыре мегабайта её с запасом
        // покрывают, а без предела чужой сервер кормил бы нас, пока не кончится
        // память.
        if (strlen($body) + strlen($chunk) > 4 * 1024 * 1024) {
            $tooLarge = true;
            return 0;
        }
        $body .= $chunk;
        return strlen($chunk);
    },
]);
$ok = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$servedBy = (string)curl_getinfo($ch, CURLINFO_PRIMARY_IP);
$error = curl_error($ch);
curl_close($ch);

// CURLOPT_RESOLVE выше не даёт повторно разрешить имя, а эта проверка остаётся
// вторым рубежом: если curl всё же пришёл не к закреплённому публичному адресу,
// ответ не разбираем.
if ($servedBy !== '' && !filter_var($servedBy, FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    cf_fail(502, 'страница увела на непубличный адрес');
}

if ($tooLarge) cf_fail(502, 'страница больше 4 МБ');
if ($ok === false || $code < 200 || $code >= 300) {
    cf_fail(502, "страница недоступна ($code $error)");
}

if ($unit['kind'] === 'html_links') {
    $items = cf_html_links($body, $pageUrl, $unit['map'], time());
    $more = cf_has_next_sub(count($items), $unit['paging'], $sub);
} elseif ($unit['kind'] === 'json') {
    $data = json_decode($body, true);
    if (!is_array($data)) cf_fail(502, 'источник ответил не JSON');
    $items = cf_json_items($data, $unit['map'], $pageUrl, time());
    // Считаем сырые записи, а не принятые: см. cf_has_next_sub.
    $rawRows = cf_dig($data, (string)($unit['map']['list'] ?? ''));
    $raw = is_array($rawRows) ? count($rawRows) : count($items);
    $more = cf_has_next_sub($raw, $unit['paging'], $sub);
} else {
    $items = cf_items($body, $pageUrl, time());
    $more = false;
}

// Сначала дочитываем порции текущего источника, потом переходим к следующему.
$hasMore = $more || $page + 1 < count($units);
$out = [
    'items' => $items,
    'has_more' => $hasMore,
    'page' => $page,
    'sub' => $sub,
    'total' => null,
];
if ($hasMore) {
    $out['next_url'] = 'https://jobtoo.ru/api/career.php?source=' . rawurlencode($sourceId)
        . '&page=' . ($more ? $page : $page + 1) . '&sub=' . ($more ? $sub + 1 : 0);
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
