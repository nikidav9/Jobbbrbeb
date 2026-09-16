<?php
// Сводные страницы: «работа комплектовщиком в Москве», «грузчиком у Алтуфьево».
//
// Это то, что люди ищут словами, и то, чего у нас нет. Отдельные страницы
// партнёрских вакансий здесь не помогут: их текст совпадает с hh.ru, и
// поисковик покажет первоисточник. А вот сводка — наша собственная работа:
// сколько открытых вакансий у этой станции, в какой вилке платят, где рядом
// есть ещё. Такого текста нет ни у источника, ни у конкурента.
//
// Тонких страниц не делаем намеренно: страница, собранная под запрос, но без
// содержания, понижает весь сайт. Поэтому есть порог — меньше LP_MIN вакансий,
// и страницы просто нет.

// Сбой базы должен быть слышен. Без строгого режима sb() возвращает пустой
// список, страница оказывается ниже порога и отдаёт 404 — то есть сообщает
// поисковику, что её больше нет, и он её выбросит. Пятьсот третий честнее.
if (!defined('SB_STRICT')) define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/vacancy_url.php';

const LP_SITE = 'https://jobtoo.ru';

/** Ниже этого числа страница не существует: пустая сводка хуже её отсутствия. */
const LP_MIN = 5;

/** Сколько вакансий показываем списком. Остальные — за кнопкой в приложение. */
const LP_LIST = 30;

/**
 * Виды работ и их адреса.
 *
 * Слова в адресе — те, которыми ищут, а не наши внутренние имена. Список
 * закрытый: он совпадает с WorkType в constants/types.ts и с классификатором
 * ing_work_type() в ingest.php, которым размечаются партнёрские вакансии.
 */
const LP_WORK = [
    'komplektovshchik' => ['type' => 'picker',           'one' => 'комплектовщиком', 'name' => 'Комплектовщик'],
    'kladovshchik'     => ['type' => 'stocker',          'one' => 'на складе',       'name' => 'Работа на складе'],
    'povar'            => ['type' => 'cook',             'one' => 'поваром',         'name' => 'Повар'],
    'brigadir'         => ['type' => 'shift_supervisor', 'one' => 'бригадиром',      'name' => 'Бригадир смены'],
];

function lp_e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Русское название станции в адрес.
 *
 * Своя таблица, а не iconv: он на разных сборках даёт разное, и адреса начали
 * бы расходиться между сервером и картой сайта. Молча и по-разному.
 */
function lp_slug(string $s): string
{
    $map = [
        'а'=>'a','б'=>'b','в'=>'v','г'=>'g','д'=>'d','е'=>'e','ё'=>'e','ж'=>'zh',
        'з'=>'z','и'=>'i','й'=>'y','к'=>'k','л'=>'l','м'=>'m','н'=>'n','о'=>'o',
        'п'=>'p','р'=>'r','с'=>'s','т'=>'t','у'=>'u','ф'=>'f','х'=>'h','ц'=>'ts',
        'ч'=>'ch','ш'=>'sh','щ'=>'sch','ъ'=>'','ы'=>'y','ь'=>'','э'=>'e','ю'=>'yu','я'=>'ya',
    ];
    $s = mb_strtolower(trim($s), 'UTF-8');
    $out = '';
    $len = mb_strlen($s, 'UTF-8');
    for ($i = 0; $i < $len; $i++) {
        $ch = mb_substr($s, $i, 1, 'UTF-8');
        if (isset($map[$ch])) { $out .= $map[$ch]; continue; }
        $out .= preg_match('/^[a-z0-9]$/', $ch) ? $ch : '-';
    }
    $out = preg_replace('/-+/', '-', $out);
    return trim((string)$out, '-');
}

function lp_money(float $v): string
{
    return number_format($v, 0, ',', ' ') . ' ₽';
}

/** «120 вакансий», «1 вакансия», «22 вакансии». */
function lp_plural(int $n, string $one, string $few, string $many): string
{
    $n10 = $n % 10;
    $n100 = $n % 100;
    if ($n10 === 1 && $n100 !== 11) return "$n $one";
    if ($n10 >= 2 && $n10 <= 4 && ($n100 < 12 || $n100 > 14)) return "$n $few";
    return "$n $many";
}

/**
 * Где работа — одной строкой для карточки.
 *
 * Станция метро, а если её нет — адрес. Без запасного варианта карточка на
 * странице про место молча оставалась без места: у партнёрских вакансий
 * станция заполнена далеко не всегда, и человек видел «ООО Бета · 4 000 ₽ за
 * смену» без единого намёка, куда ехать. Свой адрес при этом из базы забирался
 * и выбрасывался, а партнёрский не запрашивался вовсе.
 *
 * На странице станции место не повторяем: оно уже в заголовке.
 */
function lp_place(array $r, string $station): string
{
    if ($station !== '') return '';
    $metro = trim((string)($r['metro'] ?? ''));
    if ($metro !== '') return 'м. ' . $metro;

    $place = trim((string)($r['place'] ?? ''));
    if ($place === '') return '';
    // Адрес бывает длиной в строку целиком, а это подпись под названием.
    if (function_exists('mb_strlen') && mb_strlen($place, 'UTF-8') > 48) {
        $place = rtrim(mb_substr($place, 0, 47, 'UTF-8'), ' ,.') . '…';
    }
    return $place;
}

/** Живые вакансии этого вида работ, размещённые напрямую в JobToo. */
function lp_collect(string $workType): array
{
    $out = [];
    foreach (sb_select_all('jm_vacancies', ['status' => 'eq.open', 'work_type' => 'eq.' . $workType],
        'id,title,company,metro_station,salary,address') as $r) {
        $out[] = [
            'title' => (string)($r['title'] ?? ''),
            'company' => (string)($r['company'] ?? ''),
            'metro' => (string)($r['metro_station'] ?? ''),
            'place' => (string)($r['address'] ?? ''),
            'salary' => (float)($r['salary'] ?? 0),
            'per' => 'смена',
            'url' => vacancy_id_is_url_safe((string)($r['id'] ?? '')) ? LP_SITE . '/s/' . $r['id'] : '',
        ];
    }
    return $out;
}

/**
 * «Такой подборки нет».
 *
 * Отрисовка бросает исключение, а не завершает процесс: функция, которая
 * убивает процесс изнутри, не проверяется тестом и в чужом коде сработает
 * там, где её не ждали. Гасит запрос только точка входа.
 */
class LpNotFound extends RuntimeException {}

function lp_404(): void
{
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo lp_layout('Страница не найдена', '',
        '<h1>Страница не найдена</h1>'
        . '<p>Такой подборки нет — возможно, по этому запросу сейчас нет открытых вакансий.</p>'
        . '<p><a class="btn" href="' . LP_SITE . '/">Открыть JobToo</a></p>');
}

function lp_layout(string $title, string $head, string $body): string
{
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . lp_e($title) . '</title>' . $head
        . '<style>'
        . ':root{color-scheme:light dark;--fg:#111;--muted:#666;--line:#e5e5e5;--bg:#fff;--brand:#FF6B1A}'
        . '@media(prefers-color-scheme:dark){:root{--fg:#eee;--muted:#aaa;--line:#333;--bg:#111}}'
        . 'body{margin:0;padding:24px 16px;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}'
        . 'main{max-width:720px;margin:0 auto}'
        . 'h1{font-size:26px;line-height:1.25;margin:0 0 10px}'
        . 'h2{font-size:19px;margin:28px 0 10px}'
        . '.lead{color:var(--muted);margin:0 0 20px}'
        . '.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600}'
        . 'ul.list{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}'
        . 'ul.list li{padding:11px 0;border-bottom:1px solid var(--line)}'
        . 'ul.list a{color:inherit}'
        . '.meta{color:var(--muted);font-size:14px}'
        . '.links a{display:inline-block;margin:0 10px 8px 0}'
        . 'footer{margin-top:32px;color:var(--muted);font-size:14px}footer a{color:inherit}'
        . '</style></head><body><main>' . $body
        . '<footer><a href="' . LP_SITE . '/">JobToo</a> — подработка и работа в Москве</footer>'
        . '</main></body></html>';
}

/** Вилка оплаты по живым вакансиям. Считаем, а не выдумываем. */
function lp_salary_line(array $rows): string
{
    $groups = [];
    foreach ($rows as $r) {
        if (($r['salary'] ?? 0) <= 0) continue;
        $period = ($r['per'] ?? 'смена') === 'месяц' ? 'месяц' : 'смена';
        $groups[$period][] = (float)$r['salary'];
    }

    $parts = [];
    foreach (['смена', 'месяц'] as $period) {
        $vals = $groups[$period] ?? [];
        if (!$vals) continue;
        sort($vals);
        $count = count($vals);
        $min = $vals[0];
        $max = $vals[$count - 1];
        $prefix = $period === 'месяц' ? 'В месяц платят ' : 'За смену платят ';
        if ($min === $max) {
            $parts[] = $prefix . lp_money($min) . '.';
            continue;
        }
        $middle = intdiv($count, 2);
        $median = $count % 2 === 0
            ? ($vals[$middle - 1] + $vals[$middle]) / 2
            : $vals[$middle];
        $parts[] = $prefix . 'от ' . lp_money($min) . ' до ' . lp_money($max)
            . ', медианная ставка — ' . lp_money($median) . '.';
    }
    return implode(' ', $parts);
}

function lp_render(string $workSlug, string $stationSlug): void
{
    $work = LP_WORK[$workSlug];
    $all = lp_collect($work['type']);

    // Станции с достаточным числом вакансий — для перелинковки и для проверки,
    // существует ли запрошенная страница.
    $byStation = [];
    foreach ($all as $r) {
        $st = trim($r['metro']);
        if ($st !== '') $byStation[$st][] = $r;
    }

    if ($stationSlug === '') {
        $rows = $all;
        $station = '';
        $h1 = 'Работа ' . $work['one'] . ' в Москве';
    } else {
        $station = '';
        foreach ($byStation as $name => $_) {
            if (lp_slug($name) === $stationSlug) { $station = $name; break; }
        }
        if ($station === '') throw new LpNotFound();
        $rows = $byStation[$station];
        $h1 = 'Работа ' . $work['one'] . ' у метро ' . $station;
    }

    // Порог: тонкая страница без содержания вредит всему сайту.
    if (count($rows) < LP_MIN) throw new LpNotFound();

    $count = count($rows);

    $lead = 'Сейчас открыто ' . lp_plural($count, 'вакансия', 'вакансии', 'вакансий') . '. ';
    $salaryLine = lp_salary_line($rows);
    if ($salaryLine !== '') $lead .= $salaryLine;

    $list = '';
    foreach (array_slice($rows, 0, LP_LIST) as $r) {
        $title = lp_e($r['title']);
        $link = $r['url'] !== '' ? '<a href="' . lp_e($r['url']) . '">' . $title . '</a>' : $title;
        $meta = array_filter([
            $r['company'],
            lp_place($r, $station),
            $r['salary'] > 0 ? lp_money($r['salary']) . ' за ' . $r['per'] : '',
        ]);
        $list .= '<li>' . $link . '<br><span class="meta">' . lp_e(implode(' · ', $meta)) . '</span></li>';
    }

    // Перелинковка: куда ещё пойти отсюда. Роботу это даёт обход, человеку —
    // ответ на «а рядом что».
    $others = '';
    if ($station === '') {
        $names = array_keys($byStation);
        usort($names, fn($a, $b) => count($byStation[$b]) <=> count($byStation[$a]));
        foreach (array_slice($names, 0, 20) as $name) {
            if (count($byStation[$name]) < LP_MIN) continue;
            $others .= '<a href="' . LP_SITE . '/rabota/' . $workSlug . '/' . lp_slug($name) . '">'
                . lp_e($name) . '</a> ';
        }
        if ($others !== '') $others = '<h2>По станциям</h2><p class="links">' . $others . '</p>';
    } else {
        foreach (LP_WORK as $slug => $w) {
            if ($slug === $workSlug) continue;
            // Ссылаемся только туда, где страница есть. Порог тот же, что в
            // lp_render и в карте сайта: ниже него страницы не существует, и
            // ссылка вела бы человека и робота в 404. Роботу это тратит обход,
            // человеку — время.
            if (count(lp_collect($w['type'])) < LP_MIN) continue;
            $others .= '<a href="' . LP_SITE . '/rabota/' . $slug . '">' . lp_e($w['name']) . '</a> ';
        }
        if ($others !== '') $others = '<h2>Другие профессии</h2><p class="links">' . $others . '</p>';
        $others .= '<p class="links"><a href="' . LP_SITE . '/rabota/' . $workSlug . '">'
            . lp_e($work['name']) . ' по всей Москве</a></p>';
    }

    $canonical = LP_SITE . '/rabota/' . $workSlug . ($station !== '' ? '/' . $stationSlug : '');
    $head = '<link rel="canonical" href="' . lp_e($canonical) . '">'
        . '<meta name="description" content="' . lp_e($h1 . '. ' . $lead) . '">';

    $body = '<h1>' . lp_e($h1) . '</h1>'
        . '<p class="lead">' . lp_e($lead) . '</p>'
        . '<p><a class="btn" href="' . LP_SITE . '/">Смотреть в приложении</a></p>'
        . '<h2>Что открыто сейчас</h2><ul class="list">' . $list . '</ul>'
        . ($count > LP_LIST ? '<p class="meta">Показаны первые ' . LP_LIST . ' из '
            . $count . '. Остальные — в приложении.</p>' : '')
        . $others;

    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=900');
    echo lp_layout($h1 . ' | JobToo', $head, $body);
}

/**
 * Какие сводные страницы существуют прямо сейчас.
 *
 * Живёт здесь, а не в карте сайта, чтобы порог и правило адреса были в одном
 * месте. Разъедутся — карта начнёт публиковать страницы, которых нет.
 */
function lp_index(): array
{
    $urls = [];
    foreach (LP_WORK as $slug => $w) {
        $all = lp_collect($w['type']);
        if (count($all) >= LP_MIN) $urls[] = '/rabota/' . $slug;

        $byStation = [];
        foreach ($all as $r) {
            $st = trim($r['metro']);
            if ($st !== '') $byStation[$st][] = $r;
        }
        foreach ($byStation as $name => $rows) {
            if (count($rows) < LP_MIN) continue;
            $st = lp_slug($name);
            if ($st === '') continue;
            $urls[] = '/rabota/' . $slug . '/' . $st;
        }
    }
    return $urls;
}

// ── Точка входа ───────────────────────────────────────────────────────────────
// Отделена константой, чтобы тест мог взять отсюда функции, не запуская
// обработку запроса.
if (defined('LANDING_PAGE_LIB_ONLY')) return;

$workSlug = trim((string)($_GET['work'] ?? ''));
$stationSlug = trim((string)($_GET['station'] ?? ''));

try {
    if (!isset(LP_WORK[$workSlug])) throw new LpNotFound();
    if ($stationSlug !== '' && !preg_match('/^[a-z0-9-]{1,80}$/', $stationSlug)) throw new LpNotFound();
    lp_render($workSlug, $stationSlug);
} catch (LpNotFound $e) {
    lp_404();
} catch (Throwable $e) {
    // База недоступна — это не «страницы нет». Разница между 404 и 503 здесь
    // в том, выбросит поисковик страницу из выдачи или придёт снова.
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    header('Retry-After: 300');
    echo lp_layout('Сервис временно недоступен', '',
        '<h1>Сейчас не получится</h1><p>Мы чиним. Попробуйте через несколько минут.</p>');
}
