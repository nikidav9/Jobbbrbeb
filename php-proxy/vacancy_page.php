<?php
// Страница вакансии, которую отдаёт сервер.
//
// Приложение рисует вакансии в браузере, и поисковику в них показывать нечего:
// в исходнике страницы только пустая оболочка. Измерено — за 30 дней из поиска
// пришло 3 визита от 3 человек при 605 визитах всего. У прямого конкурента
// swipejobs почти 14 тысяч серверных страниц вакансий, и это его основной
// бесплатный канал.
//
// Поэтому здесь тонкий слой рядом с прокси, а не серверный рендеринг всего
// приложения: прокси уже ходит в базу и умеет отдавать HTTP, а перестройка
// клиента стоила бы недель. Приложение этот файл не трогает вовсе.
//
// Только свои вакансии. Партнёрские сюда не попадают намеренно: их текст тот
// же, что на hh.ru, и поисковик покажет первоисточник, а не нашу копию.

// Сбой базы не означает, что вакансия исчезла. В строгом режиме отличаем
// временную недоступность от настоящего 404, чтобы поисковик не удалил страницу.
if (!defined('SB_STRICT')) define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/vacancy_url.php';

const VP_SITE = 'https://jobtoo.ru';

/** Экранируем всё, что уходит в разметку. Данные вводят работодатели. */
function vp_e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function vp_404(): void
{
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo vp_layout('Вакансия не найдена', '', '<h1>Вакансия не найдена</h1>'
        . '<p>Возможно, ссылка устарела. Посмотрите, что открыто сейчас:</p>'
        . '<p><a class="btn" href="' . VP_SITE . '/">Открыть JobToo</a></p>');
    exit;
}

function vp_503(): void
{
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    header('Retry-After: 300');
    echo vp_layout('Сервис временно недоступен', '',
        '<h1>Сейчас не получится</h1><p>Мы чиним. Попробуйте через несколько минут.</p>');
    exit;
}

/**
 * Разметка JobPosting.
 *
 * Незаполненные поля не выдумываем и не подставляем заглушки: за ложные данные
 * в разметке поисковики наказывают, а «Работодатель» вместо названия компании
 * лишает страницу смысла. Нет значения — нет поля.
 */
function vp_json_ld(array $v): string
{
    $ld = [
        '@context' => 'https://schema.org',
        '@type' => 'JobPosting',
        'title' => (string)$v['title'],
        'datePosted' => substr((string)$v['created_at'], 0, 10),
        'directApply' => true,
        'hiringOrganization' => [
            '@type' => 'Organization',
            'name' => (string)$v['company'],
        ],
    ];
    if ($v['description'] !== '') $ld['description'] = $v['description'];
    if ($v['valid_through'] !== '') $ld['validThrough'] = $v['valid_through'];
    if ($v['employment_type'] !== '') $ld['employmentType'] = $v['employment_type'];

    $addr = ['@type' => 'PostalAddress', 'addressCountry' => 'RU'];
    if ($v['address'] !== '') $addr['streetAddress'] = $v['address'];
    $ld['jobLocation'] = ['@type' => 'Place', 'address' => $addr];

    if ($v['salary'] > 0) {
        $ld['baseSalary'] = [
            '@type' => 'MonetaryAmount',
            'currency' => 'RUB',
            'value' => [
                '@type' => 'QuantitativeValue',
                'value' => $v['salary'],
                'unitText' => $v['salary_unit'],
            ],
        ];
    }
    // Разметка живёт внутри <script>, а текст в неё вводят работодатели. Без
    // JSON_HEX_TAG название вакансии с «</script>» закрыло бы тег и дальше
    // исполнился бы чужой код: json_encode сам по себе от этого не защищает,
    // а JSON_UNESCAPED_SLASHES, который тут стоял, снимал последнюю случайную
    // преграду. Экранируем < > & ' " — для разбора JSON это ничего не меняет.
    return json_encode(
        $ld,
        JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_PRETTY_PRINT
    );
}

/**
 * Оболочка страницы.
 *
 * Своя, а не приложения: бандл приложения весит 4 МБ (1 МБ в сжатом виде), и
 * тянуть его ради текста вакансии бессмысленно — ни роботу, ни человеку,
 * пришедшему из поиска на одну страницу.
 */
function vp_layout(string $title, string $head, string $body): string
{
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . vp_e($title) . '</title>'
        . $head
        . '<style>'
        . ':root{color-scheme:light dark;--fg:#111;--muted:#666;--line:#e5e5e5;--bg:#fff;--brand:#FF6B1A}'
        . '@media(prefers-color-scheme:dark){:root{--fg:#eee;--muted:#aaa;--line:#333;--bg:#111}}'
        . 'body{margin:0;padding:24px 16px;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}'
        . 'main{max-width:680px;margin:0 auto}'
        . 'h1{font-size:26px;line-height:1.25;margin:0 0 8px}'
        . '.company{color:var(--muted);margin:0 0 20px}'
        . '.facts{list-style:none;padding:0;margin:0 0 20px;border-top:1px solid var(--line)}'
        . '.facts li{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}'
        . '.facts b{flex:0 0 42%;font-weight:400;color:var(--muted)}'
        . '.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600}'
        . '.closed{background:#8883;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 20px}'
        . 'footer{margin-top:32px;color:var(--muted);font-size:14px}'
        . 'footer a{color:inherit}'
        . '</style></head><body><main>' . $body
        . '<footer><a href="' . VP_SITE . '/">JobToo</a> — подработка и работа в Москве</footer>'
        . '</main></body></html>';
}

/** Приводим строку смены и строку постоянной вакансии к одному виду. */
function vp_normalize(array $row, string $kind): array
{
    $salary = (float)($row['salary'] ?? 0);
    if ($kind === 'shift') {
        $date = trim((string)($row['date'] ?? ''));
        $parts = array_filter([
            trim((string)($row['work_type_label'] ?? '')),
            trim((string)($row['norms_and_pay'] ?? '')),
            trim((string)($row['conditions'] ?? '')),
        ]);
        return [
            'kind' => 'shift',
            'id' => (string)$row['id'],
            'title' => (string)$row['title'],
            'company' => (string)$row['company'],
            'description' => implode("\n\n", $parts),
            'address' => trim((string)($row['address'] ?? '')),
            'metro' => trim((string)($row['metro_station'] ?? '')),
            'salary' => $salary,
            'salary_unit' => 'DAY',
            'employment_type' => 'TEMPORARY',
            'created_at' => (string)($row['created_at'] ?? ''),
            // Смена живёт до своей даты: после неё вакансия недействительна,
            // и это честнее, чем бессрочное объявление.
            'valid_through' => $date !== '' ? $date : '',
            'status' => (string)($row['status'] ?? 'open'),
            'schedule' => trim((string)($row['time_start'] ?? '') . '–' . (string)($row['time_end'] ?? ''), '–'),
            'date' => $date,
        ];
    }
    return [
        'kind' => 'perm',
        'id' => (string)$row['id'],
        'title' => (string)$row['title'],
        'company' => (string)$row['company'],
        'description' => trim((string)($row['description'] ?? '')),
        'address' => trim((string)($row['address'] ?? '')),
        'metro' => trim((string)($row['metro_station'] ?? '')),
        'salary' => $salary,
        'salary_unit' => 'MONTH',
        'employment_type' => 'FULL_TIME',
        'created_at' => (string)($row['created_at'] ?? ''),
        'valid_through' => '',
        'status' => (string)($row['status'] ?? 'open'),
        'schedule' => trim((string)($row['schedule'] ?? '')),
        'date' => '',
    ];
}

function vp_money(float $v): string
{
    return number_format($v, 0, ',', ' ') . ' ₽';
}

function vp_render(array $v): void
{
    $isClosed = $v['status'] !== 'open';
    $url = VP_SITE . ($v['kind'] === 'shift' ? '/s/' : '/v/') . rawurlencode($v['id']);

    // Закрытую вакансию не удаляем и не прячем под 404: страница уже накопила
    // вес, а ссылки на неё остались снаружи. Вместо этого честная отметка и
    // срок действия в прошлом — робот поймёт сам, человек прочитает.
    $validThrough = $v['valid_through'];
    if ($isClosed && $validThrough === '') {
        $validThrough = substr((string)($v['created_at'] ?: gmdate('c')), 0, 10);
    }
    $v['valid_through'] = $validThrough;

    $facts = '';
    $add = function (string $k, string $val) use (&$facts) {
        if ($val !== '') $facts .= '<li><b>' . vp_e($k) . '</b><span>' . vp_e($val) . '</span></li>';
    };
    if ($v['salary'] > 0) {
        $add($v['kind'] === 'shift' ? 'Оплата за смену' : 'Зарплата', vp_money($v['salary']));
    }
    $add('Дата смены', $v['date']);
    $add('Время', $v['schedule']);
    $add('Метро', $v['metro']);
    $add('Адрес', $v['address']);

    $desc = '';
    foreach (preg_split('/\n{2,}/', $v['description']) as $p) {
        $p = trim($p);
        if ($p !== '') $desc .= '<p>' . nl2br(vp_e($p)) . '</p>';
    }

    // Короткое описание для выдачи: первые полторы сотни символов текста, без
    // разметки и переносов.
    $metaDesc = trim(preg_replace('/\s+/u', ' ', $v['description']));
    if ($metaDesc === '') {
        $metaDesc = $v['company'] . ' ищет: ' . $v['title']
            . ($v['address'] !== '' ? ', ' . $v['address'] : '');
    }
    if (function_exists('mb_substr') && mb_strlen($metaDesc, 'UTF-8') > 160) {
        $metaDesc = mb_substr($metaDesc, 0, 157, 'UTF-8') . '…';
    }

    $pageTitle = $v['title'] . ' — ' . $v['company']
        . ($v['metro'] !== '' ? ', ' . $v['metro'] : '') . ' | JobToo';

    $head = '<link rel="canonical" href="' . vp_e($url) . '">'
        . '<meta name="description" content="' . vp_e($metaDesc) . '">'
        . '<script type="application/ld+json">' . vp_json_ld($v) . '</script>';

    $body = ($isClosed ? '<div class="closed">Эта вакансия закрыта. Похожие смены и вакансии — в приложении.</div>' : '')
        . '<h1>' . vp_e($v['title']) . '</h1>'
        . '<p class="company">' . vp_e($v['company']) . '</p>'
        . ($facts !== '' ? '<ul class="facts">' . $facts . '</ul>' : '')
        . $desc
        . '<p><a class="btn" href="' . VP_SITE . '/">'
        . ($isClosed ? 'Смотреть открытые вакансии' : 'Откликнуться в приложении')
        . '</a></p>';

    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    // Кэш короткий: вакансию закрывают в любой момент, и висящая сутки копия
    // отправит человека на смену, которой уже нет.
    header('Cache-Control: public, max-age=300');
    echo vp_layout($pageTitle, $head, $body);
}

// ── Точка входа ───────────────────────────────────────────────────────────────
//
// Отделена от функций той же константой, которой пользуется тест: подключив
// файл, он получает функции, но не запускает обработку запроса. Ровно та
// причина, по которой нельзя подключать db.php — он не библиотека, а обработчик.
if (defined('VACANCY_PAGE_LIB_ONLY')) return;

$kind = ($_GET['kind'] ?? '') === 'shift' ? 'shift' : 'perm';
$id = trim((string)($_GET['id'] ?? ''));
if (!vacancy_id_is_url_safe($id)) vp_404();

$table = $kind === 'shift' ? 'jm_vacancies' : 'jm_perm_vacancies';
try {
    $row = sb_single($table, ['id' => 'eq.' . $id]);
} catch (Throwable $e) {
    vp_503();
}
if (!$row) vp_404();

vp_render(vp_normalize($row, $kind));
