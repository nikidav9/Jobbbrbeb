<?php
// Карьерные страницы работодателей → общий формат фида JobToo.
//
// Читает адреса из connector_config источника, ходит по одному за запрос и
// отдаёт вакансии в том же виде, что headhunter.php и trudvsem.php: ingest.php
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

// Точка входа открыта, как открыты headhunter.php и trudvsem.php: пишет в базу
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
$pages = is_array($config['pages'] ?? null) ? array_values($config['pages']) : [];
// Список задаёт администратор в панели. Это не повод пускать сборщик куда
// угодно: адрес всё равно проходит ту же проверку, что и адрес источника —
// только публичный HTTPS, без localhost, служебных сетей и метаданных облака.
$pages = array_values(array_filter($pages, fn($u) => is_string($u) && ing_safe_https_url($u)));
if (!$pages) cf_fail(422, 'у источника нет годных адресов карьерных страниц');
if ($page >= count($pages)) cf_fail(404, 'страница за пределами списка');

$pageUrl = $pages[$page];

$body = '';
$tooLarge = false;
$ch = curl_init($pageUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml'],
    CURLOPT_USERAGENT => 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)',
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 45,
    // Переход по редиректу увёл бы нас на адрес, который проверку не проходил:
    // так обходят запрет на служебные сети.
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
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

// Проверка адреса разрешает имя в адрес сама, curl потом разрешает его ещё
// раз — и между двумя разрешениями чужой сервер имён волен ответить иначе.
// Так обходят запрет на служебные сети: первый ответ публичный, второй —
// 127.0.0.1. Смотрим, к КОМУ мы в итоге пришли, и если это служебная сеть,
// выбрасываем ответ, не разбирая: запрос уже ушёл, но содержимое чужой
// внутренней службы наружу не попадёт.
if ($servedBy !== '' && !filter_var($servedBy, FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    cf_fail(502, 'страница увела на непубличный адрес');
}

if ($tooLarge) cf_fail(502, 'страница больше 4 МБ');
if ($ok === false || $code < 200 || $code >= 300) {
    cf_fail(502, "страница недоступна ($code $error)");
}

$items = cf_items($body, $pageUrl, time());

$hasMore = $page + 1 < count($pages);
$out = [
    'items' => $items,
    'has_more' => $hasMore,
    'page' => $page,
    'total' => null,
];
if ($hasMore) {
    $out['next_url'] = 'https://jobtoo.ru/api/career.php?source=' . rawurlencode($sourceId)
        . '&page=' . ($page + 1);
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
