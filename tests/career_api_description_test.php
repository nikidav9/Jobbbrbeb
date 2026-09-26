<?php
// Описание из API источника, а не со страницы: разделы из полей списка
// (map.description_sections), JSON-карточка вакансии (map.detail_*), курсор
// Яндекса (paging cursor_b64) и пачки upsert с одинаковыми колонками.
// Только чистые функции — ни сети, ни базы.

define('DESCRIBE_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/describe.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Разделы из полей: строка-markdown, список строк, вступление без заголовка ──

$text = vt_sections_from_fields([
    'introduction' => 'Сбер раскроет твой потенциал.',
    'duties' => "*   обслуживать клиентов\n*   проводить операции",
    'requirements' => ['образование среднее и выше', 'доброжелательность'],
    'conditions' => '',
], ['' => 'introduction', 'Обязанности' => 'duties', 'Требования' => 'requirements', 'Условия' => 'conditions']);
check('вступление без заголовка идёт первым', str_starts_with($text, 'Сбер раскроет твой потенциал.'));
check('markdown-пункты стали «• »', str_contains($text, "## Обязанности\n\n• обслуживать клиентов\n• проводить операции"));
check('список строк стал пунктами', str_contains($text, "## Требования\n\n• образование среднее и выше\n• доброжелательность"));
check('пустой раздел не выводится', !str_contains($text, 'Условия'));

check('вложенный путь через точку', vt_sections_from_fields(
    ['v' => ['d' => 'текст']], ['Раздел' => 'v.d']) === "## Раздел\n\nтекст");
check('markdown со вставкой <b> не склеивается в абзац', vt_sections_from_fields(
    ['d' => "Вступление.\r\n\r\n<b>Как это выглядит:</b>\r\n\r\n* раз\r\n* два"], ['' => 'd'])
    === "Вступление.\n\nКак это выглядит:\n\n• раз\n• два");
check('«•» с табом (Альфа-Банк) — обычный пункт', vt_sections_from_fields(
    ['d' => "•\tраз\r\n•\tдва"], ['Требования' => 'd']) === "## Требования\n\n• раз\n• два");
check('HTML в поле разбирается как HTML', str_contains(
    vt_sections_from_fields(['d' => '<ul><li>один</li><li>два</li></ul>'], ['Обязанности' => 'd']), '• один'));

// ── Список: description_sections → description_full, detail_* → detail_spec ──

$long = str_repeat('Разрабатывать сервисы и улучшать их. ', 5);
$items = cf_json_items(['results' => [[
    'id' => 15322, 'title' => 'Бэкенд-разработчик', 'slug' => 'backend-15322',
    'intro' => 'Коротко о вакансии', 'duties' => $long,
]]], [
    'list' => 'results', 'id' => 'id', 'title' => 'title', 'description' => 'intro',
    'url_template' => 'https://yandex.ru/jobs/vacancies/{slug}',
    'description_sections' => ['Обязанности' => 'duties'],
    'detail_url_template' => 'https://yandex.ru/jobs/api/publications/{id}',
    'detail_sections' => ['Обязанности' => 'duties'],
], 'https://yandex.ru/jobs/api/publications', time());
$it = $items[0] ?? [];
check('description_full из разделов', str_starts_with((string)($it['description_full'] ?? ''), "## Обязанности\n\n"));
check('короткий анонс остаётся своим полем', ($it['description'] ?? '') === 'Коротко о вакансии');
check('detail_spec: адрес карточки подставлен', ($it['detail_spec']['url'] ?? '') === 'https://yandex.ru/jobs/api/publications/15322');
check('detail_spec: разделы переданы', ($it['detail_spec']['sections'] ?? null) === ['Обязанности' => 'duties']);

$short = cf_json_items(['results' => [['id' => 1, 'title' => 'Кассир', 'u' => 'https://a.ru/1', 'd' => 'мало']]],
    ['list' => 'results', 'title' => 'title', 'url' => 'u', 'description_sections' => ['Обязанности' => 'd']],
    'https://a.ru/api', time());
check('слишком короткие разделы не выдаются за полное описание', !isset($short[0]['description_full']));

$plain = cf_json_items(['results' => [['id' => 1, 'title' => 'Кассир', 'u' => 'https://a.ru/1']]],
    ['list' => 'results', 'title' => 'title', 'url' => 'u'], 'https://a.ru/api', time());
check('без настроек новых ключей нет', !isset($plain[0]['description_full']) && !isset($plain[0]['detail_spec']));

// ── Курсор Яндекса: base64 от «o=смещение&p=страница» ──────────────────────

$paging = ['type' => 'cursor_b64', 'param' => 'cursor', 'template' => 'o={offset}&p={page}',
           'limit' => 20, 'limit_param' => 'page_size'];
$first = cf_page_url('https://yandex.ru/jobs/api/publications?cities=moscow', $paging, 0);
check('первая порция без курсора', $first === 'https://yandex.ru/jobs/api/publications?cities=moscow&page_size=20');
parse_str((string)parse_url(cf_page_url('https://yandex.ru/jobs/api/publications?cities=moscow', $paging, 2), PHP_URL_QUERY), $q);
check('третья порция: смещение 40, страница 3', base64_decode((string)($q['cursor'] ?? '')) === 'o=40&p=3');
check('город в запросе сохраняется', ($q['cities'] ?? '') === 'moscow');

// ── Пачки upsert: у всех строк запроса одни и те же ключи ───────────────────

$chunks = ing_chunks_by_columns([
    ['id' => 1, 'title' => 'a'],
    ['id' => 2, 'title' => 'b', 'description_full' => 'x', 'described_at' => 'now'],
    ['title' => 'c', 'id' => 3],
], 200);
check('две пачки по наборам колонок', count($chunks) === 2);
$sameKeys = true;
foreach ($chunks as $chunk) {
    $sig = null;
    foreach ($chunk as $row) {
        $keys = array_keys($row); sort($keys);
        $sig ??= $keys;
        if ($keys !== $sig) $sameKeys = false;
    }
}
check('внутри пачки ключи совпадают, порядок ключей не важен', $sameKeys);
check('строки не теряются', array_sum(array_map('count', $chunks)) === 3);

// ── describe.php: JSON-карточка вакансии ────────────────────────────────────

$spec = ['url' => 'https://rabota.magnit.ru/api/v1/vacancy/1', 'list' => 'results',
         'sections' => ['Обязанности' => 'responsibilities', 'Условия' => 'motivation']];
$body = json_encode(['success' => true, 'results' => [
    'responsibilities' => ['Выкладывать товар на полки и следить за сроками годности', 'Помогать покупателям в зале'],
    'motivation' => ['Официальное оформление с первого дня', 'Скидка сотрудника 10% в сети магазинов'],
]], JSON_UNESCAPED_UNICODE);
$described = ds_describe_detail($body, $spec);
check('карточка → разделы', is_string($described) && str_contains($described, "## Условия\n\n• Официальное оформление"));
check('не JSON — null', ds_describe_detail('<html></html>', $spec) === null);
check('нет ответа — null', ds_describe_detail(null, $spec) === null);
check('короткая карточка — null', ds_describe_detail(json_encode(['results' => ['responsibilities' => ['мало']]]), $spec) === null);

if ($failures) {
    fwrite(STDERR, "career_api_description: провалы:\n  - " . implode("\n  - ", $failures) . "\n");
    exit(1);
}
echo "career_api_description: ok\n";
