<?php
// Карта сайта, собираемая на лету.
//
// Раньше здесь лежал файл на пять статических адресов. Он не врал, но и не
// помогал: страниц вакансий в нём не было, потому что их не существовало.
// Теперь они есть, и карта собирается из базы.
//
// В карту попадают только ОТКРЫТЫЕ свои вакансии. Закрытые остаются доступны
// по своим адресам — их страницы накопили вес, и удалять их вредно, — но
// звать робота перечитывать закрытое незачем.
//
// Партнёрских вакансий здесь нет и не будет до тех пор, пока мы не научимся
// давать по ним что-то своё: их текст совпадает с hh.ru, и ссылка на копию
// хуже её отсутствия.

// Сбой базы должен быть слышен. Без строгого режима sb() возвращает пустой
// список, и карта уходит роботу с одними статическими адресами — с ответом
// 200 и часовым кэшем. Для поисковика это значит «все вакансии и все сводные
// страницы исчезли», и он их выбросит. Пятьсот третий честнее: робот придёт
// снова.
if (!defined('SB_STRICT')) define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/vacancy_url.php';
// Берём из сводных страниц только перечень: константа гасит их точку входа.
define('LANDING_PAGE_LIB_ONLY', true);
require_once __DIR__ . '/landing_page.php';
require_once __DIR__ . '/sitemap_cache.php';

const SM_SITE = 'https://jobtoo.ru';
const SM_CACHE_TTL = 3600;
const SM_HTTP_CACHE_TTL = 300;
$smCacheFile = sm_cache_default_path();

$cached = sm_cache_read($smCacheFile, time(), SM_CACHE_TTL);
if ($cached !== null) {
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=' . SM_HTTP_CACHE_TTL);
    header('X-JobToo-Sitemap-Cache: HIT');
    echo $cached;
    exit;
}

/** Адреса, которые есть всегда. */
const SM_STATIC = [
    '/',
    '/legal?doc=terms',
    '/legal?doc=privacy',
    '/legal?doc=dataPolicy',
    '/legal?doc=consent',
    '/legal?doc=marketing',
];

function sm_url(string $loc, string $lastmod = ''): string
{
    $x = '  <url>' . "\n";
    $x .= '    <loc>' . htmlspecialchars($loc, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</loc>' . "\n";
    if ($lastmod !== '') $x .= '    <lastmod>' . htmlspecialchars($lastmod, ENT_XML1, 'UTF-8') . '</lastmod>' . "\n";
    $x .= '  </url>' . "\n";
    return $x;
}

/** Дата в виде ГГГГ-ММ-ДД: карта не любит произвольные метки времени. */
function sm_day(?string $ts): string
{
    $ts = trim((string)$ts);
    if ($ts === '') return '';
    return preg_match('/^\d{4}-\d{2}-\d{2}/', $ts) ? substr($ts, 0, 10) : '';
}

$body = '';
try {
foreach (SM_STATIC as $path) {
    $body .= sm_url(SM_SITE . $path);
}

// Обе таблицы своих вакансий. sb_select_all ходит постранично: Supabase режет
// выборку, и без этого карта однажды тихо обрежется на тысяче адресов.
$sources = [
    ['table' => 'jm_perm_vacancies', 'prefix' => '/v/'],
    ['table' => 'jm_vacancies',      'prefix' => '/s/'],
];
foreach ($sources as $src) {
    $rows = sb_select_all($src['table'], ['status' => 'eq.open'], 'id,created_at,updated_at');
    foreach ($rows as $r) {
        $id = trim((string)($r['id'] ?? ''));
        // Не публикуем адрес, который сами не обслужим: см. vacancy_url.php.
        if (!vacancy_id_is_url_safe($id)) continue;
        $lastmod = sm_day($r['updated_at'] ?? '') ?: sm_day($r['created_at'] ?? '');
        $body .= sm_url(SM_SITE . $src['prefix'] . $id, $lastmod);
    }
}

// Сводные страницы: «работа комплектовщиком у Алтуфьево». Перечень считает
// сам landing_page.php — там же порог, ниже которого страницы нет.
foreach (lp_index() as $path) {
    $body .= sm_url(SM_SITE . $path);
}

} catch (Throwable $e) {
    // См. выше: лучше честный отказ, чем карта, обещающая пустой сайт.
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Retry-After: 300');
    echo "карта сайта временно недоступна\n";
    exit;
}

$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
    . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n"
    . $body
    . '</urlset>' . "\n";

// Записываем только карту, которую полностью собрали без исключений.
// Неудача записи не прячет рабочий ответ и повторится на следующем запросе.
sm_cache_write($smCacheFile, $xml);

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=' . SM_HTTP_CACHE_TTL);
header('X-JobToo-Sitemap-Cache: MISS');
echo $xml;
