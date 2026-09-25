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
// Поход за одной порцией и построение юнита из записи endpoint — общий код с
// career_verify.php: разведка проверяет адрес ровно тем, чем потом идёт сбор.
require_once __DIR__ . '/career_unit.php';

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

/**
 * Ответ приёмнику: что нашли и куда идти дальше.
 *
 * $failed — адрес, на котором споткнулись прямо сейчас. Он НЕ делает ответ
 * ошибочным: ingest.php на ошибку прекращает заход целиком и запоминает адрес в
 * контрольной точке, а стирает её только после полного успешного обхода. Так
 * одна недоступная страница вставала намертво поперёк всех остальных компаний —
 * ровно это и держало раздел «Работа» на прошлых вакансиях.
 *
 * Поле partial говорит приёмнику: обход дошёл до конца, но не весь. По нему
 * ingest.php не гасит вакансии, которых не увидел, — иначе один 403 у
 * работодателя стирал бы его вакансии из ленты до следующего круга.
 */
function cf_emit(array $items, ?array $step, string $sourceId, int $page, int $sub,
                 array $skipped, ?array $failed, array $hosts = []): void
{
    $out = [
        'items' => $items,
        'has_more' => $step !== null,
        'page' => $page,
        'sub' => $sub,
        'total' => null,
        // Свои хосты адреса: сам адрес и шаблон ссылки на вакансию. По ним
        // ingest.php гасит пропавшие вакансии сайта, прошедшего целиком. Не по
        // хостам присланных ссылок: чужой хост (hh.ru, habr) мог бы оказаться
        // общим у двух адресов, и сбой одного погасил бы живые вакансии.
        'hosts' => $hosts,
    ];
    // Пусть о выпавших адресах знает и приёмник, и человек в панели.
    if ($skipped) $out['skipped'] = $skipped;
    if ($failed) {
        $out['failed'] = [$failed];
        $out['partial'] = true;
    }
    if ($step !== null) {
        $out['next_url'] = 'https://jobtoo.ru/api/career.php?source=' . rawurlencode($sourceId)
            . (CF_ONLY_API ? '&modes=api' : '')
            . '&page=' . $step['page'] . '&sub=' . $step['sub'];
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$sourceId = trim((string)($_GET['source'] ?? ''));
if ($sourceId === '' || !preg_match('~^[A-Za-z0-9._-]{1,64}$~', $sourceId)) {
    cf_fail(400, 'нет источника');
}
// modes=api — только адреса с настоящим API (JSON и встроенное состояние),
// без страниц со ссылками. Так ingest.php раз в час обновляет то, что
// обновлять дёшево, не трогая чужие сайты-витрины чаще раза в шесть часов.
define('CF_ONLY_API', ($_GET['modes'] ?? '') === 'api');
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
    if (is_string($u)) $units[] = ['url' => $u, 'kind' => 'html', 'map' => [], 'paging' => [], 'post' => false, 'body' => null];
}
foreach (is_array($config['endpoints'] ?? null) ? $config['endpoints'] : [] as $e) {
    if (!is_array($e)) continue;
    $unitFromEndpoint = cf_unit_from_endpoint($e);
    if ($unitFromEndpoint !== null) $units[] = $unitFromEndpoint;
}
if (CF_ONLY_API) {
    $units = array_values(array_filter($units, fn($u) => in_array($u['kind'], ['json', 'embedded'], true)));
}
// Список задаёт администратор в панели. Это не повод пускать сборщик куда
// угодно: адрес всё равно проходит ту же проверку, что и адрес источника —
// только публичный HTTPS, без localhost, служебных сетей и метаданных облака.
// Отброшенные адреса запоминаем поимённо. Раньше они исчезали молча: в
// настройке было 24 источника, а обход видел 23, и понять, какой выпал и
// почему, было нечем — заметил это только сплошной проверкой на проде.
$skipped = [];
$units = array_values(array_filter($units, function ($u) use (&$skipped) {
    if (ing_safe_https_url($u['url'])) return true;
    $skipped[] = $u['url'];
    return false;
}));
if (!$units) cf_fail(422, 'у источника нет годных адресов карьерных страниц');
if ($page >= count($units)) cf_fail(404, 'страница за пределами списка');

$unit = $units[$page];
$total = count($units);
// Споткнулись на этом работодателе — идём к следующему, а не рушим обход.
// Порции текущего не дочитываем: не ответил адрес — не ответит и его вторая
// страница.
$ownHosts = [];
foreach ([$unit['url'], (string)($unit['map']['url_template'] ?? '')] as $u) {
    $h = strtolower((string)(parse_url($u, PHP_URL_HOST) ?? ''));
    if ($h !== '') $ownHosts[$h] = true;
}
$ownHosts = array_keys($ownHosts);
$skipUnit = function (string $reason) use ($sourceId, $page, $sub, $skipped, $total, $unit, $ownHosts): void {
    cf_emit([], cf_next_step($page, $sub, $total, false, true), $sourceId, $page, $sub,
        $skipped, ['url' => $unit['url'], 'reason' => $reason], $ownHosts);
};

// Поход за порцией и её разбор — тот же код, которым разведка на сервере
// заранее проверяет endpoint, прежде чем его включить: см. career_unit.php.
$fetched = cf_fetch_unit($unit, $sub);
if ($fetched['error'] !== null) $skipUnit($fetched['error']);
$items = $fetched['items'];
$more = $fetched['more'];
// Сайт ответил, но настоящих вакансий почти нет, а мусор есть (или нет
// ничего) — это перевёрстка, а не пустой список. Выдачу не принимаем и идём
// дальше как по недоступному адресу: прежние вакансии этого работодателя на
// круге не гаснут, причина видна в журнале. Решаем по первой порции: у
// последней страницы честно бывает одна-две вакансии.
if ($sub === 0 && cf_quality_rejects((int)($fetched['raw'] ?? count($items)), count($items))) {
    $why = array_count_values(array_column($fetched['rejected'] ?? [], 'why'));
    arsort($why);
    $skipUnit('мало настоящих вакансий: ' . count($items) . ' из ' . (int)($fetched['raw'] ?? 0)
        . ($why ? ' (' . implode(', ', array_map(fn($k, $v) => "$k — $v", array_keys($why), $why)) . ')' : ''));
}

// Сначала дочитываем порции текущего источника, потом переходим к следующему.
cf_emit($items, cf_next_step($page, $sub, $total, $more, false), $sourceId, $page, $sub,
    $skipped, null, $ownHosts);