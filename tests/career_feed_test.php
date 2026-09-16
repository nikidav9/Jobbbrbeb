<?php
// Разбор карьерной страницы работодателя.
//
// Проверяем не «разобралось», а то, от чего зависит показ человеку: деньги,
// ссылку на первоисточник и то, что закрытая вакансия не попадёт в ленту.
// Разметку пишут чужие сайты, и половина случаев здесь — кривые, но реальные:
// @graph, списки, вилка вместо числа, доллары, две копии одной вакансии.

require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$now = 1_757_700_000;
$page = 'https://sklad-alpha.ru/vacancies';

function page_with(string $json): string
{
    return '<!doctype html><html><head><title>Вакансии</title>'
        . '<script type="application/ld+json">' . $json . '</script>'
        . '</head><body><h1>Вакансии</h1></body></html>';
}

// ── Обычная вакансия ──────────────────────────────────────────────────────────
$one = json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'JobPosting',
    'title' => 'Комплектовщик на склад',
    'identifier' => ['@type' => 'PropertyValue', 'value' => 'A-17'],
    'url' => 'https://sklad-alpha.ru/vacancies/a-17',
    'description' => '<p>Сборка заказов.</p><p>Оплата <b>еженедельно</b>.</p>',
    'hiringOrganization' => ['@type' => 'Organization', 'name' => 'Склад Альфа'],
    'jobLocation' => ['@type' => 'Place', 'address' => [
        '@type' => 'PostalAddress', 'streetAddress' => 'ул. Складская, 4', 'addressLocality' => 'Москва']],
    'baseSalary' => ['@type' => 'MonetaryAmount', 'currency' => 'RUB',
        'value' => ['@type' => 'QuantitativeValue', 'value' => 4200, 'unitText' => 'DAY']],
    'employmentType' => 'FULL_TIME',
], JSON_UNESCAPED_UNICODE);

$items = cf_items(page_with($one), $page, $now);
check('одна вакансия найдена', count($items) === 1);
$i = $items[0] ?? [];
check('номер взят из разметки', ($i['id'] ?? '') === 'A-17');
check('название на месте', ($i['title'] ?? '') === 'Комплектовщик на склад');
check('ссылка на первоисточник', ($i['url'] ?? '') === 'https://sklad-alpha.ru/vacancies/a-17');
check('работодатель на месте', ($i['company'] ?? '') === 'Склад Альфа');
check('адрес собран', ($i['address'] ?? '') === 'ул. Складская, 4, Москва');
check('оплата взята', ($i['pay'] ?? null) === 4200.0);
check('период оплаты взят', ($i['pay_period'] ?? '') === 'DAY');
check('теги из описания убраны', !str_contains((string)($i['description'] ?? ''), '<p>'));
check('текст описания сохранён', str_contains((string)($i['description'] ?? ''), 'Сборка заказов.'));

// Ключи должны совпадать с теми, что читает ingest.php, — иначе поле молча
// пропадёт, как это уже было с metro у hh.ru.
$ingest = (string)file_get_contents(__DIR__ . '/../php-proxy/ingest.php');
preg_match_all("~\\\$it\\['([a-z_]+)'\\]~", $ingest, $m);
$known = array_unique($m[1]);
foreach (array_keys($i) as $key) {
    check("ключ '$key' читается приёмником", in_array($key, $known, true));
}

// ── @graph и списки ───────────────────────────────────────────────────────────
$graph = json_encode(['@context' => 'https://schema.org', '@graph' => [
    ['@type' => 'Organization', 'name' => 'Склад Альфа'],
    ['@type' => ['JobPosting'], 'title' => 'Грузчик', 'url' => 'https://sklad-alpha.ru/v/1'],
]], JSON_UNESCAPED_UNICODE);
check('вакансия найдена внутри @graph', count(cf_items(page_with($graph), $page, $now)) === 1);

$list = json_encode([
    ['@type' => 'JobPosting', 'title' => 'Грузчик', 'url' => 'https://sklad-alpha.ru/v/1'],
    ['@type' => 'JobPosting', 'title' => 'Кладовщик', 'url' => 'https://sklad-alpha.ru/v/2'],
], JSON_UNESCAPED_UNICODE);
check('список вакансий разобран', count(cf_items(page_with($list), $page, $now)) === 2);

// Одна вакансия часто размечена дважды — в перечне и в карточке.
$twice = page_with($one) . '<script type="application/ld+json">' . $one . '</script>';
check('дубль по номеру схлопнут', count(cf_items($twice, $page, $now)) === 1);

// ── Деньги ────────────────────────────────────────────────────────────────────
function salary_item(array $baseSalary, int $now, string $page): array
{
    $j = json_encode(['@type' => 'JobPosting', 'title' => 'Грузчик',
        'url' => 'https://sklad-alpha.ru/v/9', 'baseSalary' => $baseSalary], JSON_UNESCAPED_UNICODE);
    return cf_items(page_with($j), $page, $now)[0] ?? [];
}
// Вилку сводим к нижней границе: это то, на что человек может рассчитывать.
$i = salary_item(['currency' => 'RUB', 'value' => ['minValue' => 3000, 'maxValue' => 5000]], $now, $page);
check('вилка сведена к нижней границе', ($i['pay'] ?? null) === 3000.0);
// Чужая валюта на московском складе — ошибка разметки. Соврать о деньгах
// хуже, чем не назвать их.
$i = salary_item(['currency' => 'USD', 'value' => ['value' => 50]], $now, $page);
check('доллары не выдаются за рубли', !isset($i['pay']));
check('вакансия без суммы всё равно взята', ($i['title'] ?? '') === 'Грузчик');
$i = salary_item(['currency' => 'RUB', 'value' => 3500], $now, $page);
check('сумма числом, а не объектом', ($i['pay'] ?? null) === 3500.0);
$i = salary_item(['currency' => 'RUB', 'value' => ['value' => 0]], $now, $page);
check('ноль — не сумма', !isset($i['pay']));

// ── Закрытая вакансия ─────────────────────────────────────────────────────────
$expired = json_encode(['@type' => 'JobPosting', 'title' => 'Грузчик',
    'url' => 'https://sklad-alpha.ru/v/3',
    'validThrough' => gmdate('Y-m-d', $now - 86400)], JSON_UNESCAPED_UNICODE);
check('просроченная вакансия не берётся', cf_items(page_with($expired), $page, $now) === []);
$live = json_encode(['@type' => 'JobPosting', 'title' => 'Грузчик',
    'url' => 'https://sklad-alpha.ru/v/3',
    'validThrough' => gmdate('Y-m-d', $now + 30 * 86400)], JSON_UNESCAPED_UNICODE);
check('действующая вакансия берётся', count(cf_items(page_with($live), $page, $now)) === 1);

// ── Чего брать нельзя ─────────────────────────────────────────────────────────
$noTitle = json_encode(['@type' => 'JobPosting', 'url' => 'https://sklad-alpha.ru/v/4'], JSON_UNESCAPED_UNICODE);
check('без названия не берём', cf_items(page_with($noTitle), $page, $now) === []);
// Без ссылки берём адрес самой страницы: это всё ещё путь к первоисточнику.
$noUrl = json_encode(['@type' => 'JobPosting', 'title' => 'Грузчик'], JSON_UNESCAPED_UNICODE);
$i = cf_items(page_with($noUrl), $page, $now)[0] ?? [];
check('без ссылки берём адрес страницы', ($i['url'] ?? '') === $page);
check('номер выведен из адреса', ($i['id'] ?? '') !== '' && strlen((string)$i['id']) === 24);
// А вот если и страница не https — брать нечего.
check('нешифрованный адрес отвергнут', cf_items(page_with($noUrl), 'http://sklad-alpha.ru/v', $now) === []);
// Чужая разметка не про вакансии нас не касается.
$other = json_encode(['@type' => 'Organization', 'name' => 'Склад Альфа'], JSON_UNESCAPED_UNICODE);
check('не-вакансии пропущены', cf_items(page_with($other), $page, $now) === []);
check('мусор вместо JSON не роняет разбор', cf_items(page_with('{не json'), $page, $now) === []);
check('страница без разметки пуста', cf_items('<html><body>ничего</body></html>', $page, $now) === []);

// ── Разметка, записанная не по учебнику ───────────────────────────────────────
$messy = '<script  type = "application/ld+json"  data-x="1" >'
    . json_encode(['@type' => 'jobposting', 'name' => 'Кладовщик',
        'url' => 'https://sklad-alpha.ru/v/5',
        'hiringOrganization' => 'Склад Альфа',
        'jobLocation' => [['@type' => 'Place', 'address' => ['addressLocality' => 'Москва']]],
    ], JSON_UNESCAPED_UNICODE) . '</script>';
$i = cf_items($messy, $page, $now)[0] ?? [];
check('тип в нижнем регистре опознан', ($i['title'] ?? '') === 'Кладовщик');
check('работодатель строкой опознан', ($i['company'] ?? '') === 'Склад Альфа');
check('место списком опознано', ($i['address'] ?? '') === 'Москва');

// Глубина обхода ограничена: страницу присылает чужой сервер, и уходить в
// рекурсию по его данным нельзя. Разумную вложенность при этом достаём.
function nested(int $depth): string
{
    $leaf = ['@type' => 'JobPosting', 'title' => 'Грузчик', 'url' => 'https://sklad-alpha.ru/v/8'];
    for ($d = 0; $d < $depth; $d++) $leaf = ['@type' => 'WebPage', 'child' => $leaf];
    return json_encode($leaf, JSON_UNESCAPED_UNICODE);
}
check('вакансия в разумной вложенности найдена', count(cf_items(page_with(nested(3)), $page, $now)) === 1);
check('слишком глубокая вложенность отброшена', cf_items(page_with(nested(60)), $page, $now) === []);


// ─── Листание JSON-источников ───────────────────────────────────────────────
// Карьерные API отдают вакансии порциями, и без листания источник приносил бы
// только первую: у Сбера 50 из 1795, у Ростелекома 20 из 382. Всё, что ниже,
// снято с живых ответов, а не придумано.

check('offset: первая порция без смещения',
    cf_page_url('https://x.ru/api/v1/vacancies', ['type' => 'offset', 'limit' => 100], 0)
    === 'https://x.ru/api/v1/vacancies?limit=100&offset=0');

check('offset: вторая порция смещена на размер порции',
    cf_page_url('https://x.ru/api/v1/vacancies', ['type' => 'offset', 'limit' => 100], 2)
    === 'https://x.ru/api/v1/vacancies?limit=100&offset=200');

// Сбер зовёт те же параметры take/skip, поэтому имена настраиваются.
check('offset: имена параметров берутся из настройки',
    cf_page_url('https://rabota.sber.ru/api/v1/publications',
        ['type' => 'offset', 'param' => 'skip', 'limit_param' => 'take', 'limit' => 50], 3)
    === 'https://rabota.sber.ru/api/v1/publications?take=50&skip=150');

// У Ростелекома и МегаФона нумерация страниц с единицы, у других с нуля.
check('page: нумерация начинается с заданного числа',
    cf_page_url('https://job.rt.ru/backend/api/vacancies', ['type' => 'page', 'start' => 1], 2)
    === 'https://job.rt.ru/backend/api/vacancies?page=3');

// Параметр из самого адреса терять нельзя: у Авиасейлса там язык выдачи.
check('уже имеющийся параметр адреса сохраняется',
    str_contains(cf_page_url('https://x.ru/api/vacancies?language=ru',
        ['type' => 'offset', 'limit' => 10], 1), 'language=ru'));

check('без настройки листания адрес не трогаем',
    cf_page_url('https://x.ru/api/vacancies', [], 0) === 'https://x.ru/api/vacancies');

// Полная порция — берём следующую. Признак «полная» надёжнее счётчика total:
// total присылают не все, а врут в нём многие.
check('полная порция — идём дальше', cf_has_next_sub(50, ['type' => 'offset', 'limit' => 50], 0) === true);
check('неполная порция — останавливаемся', cf_has_next_sub(31, ['type' => 'offset', 'limit' => 50], 0) === false);

// Предел страниц обязателен: сломанный источник, отдающий одно и то же, крутил
// бы обход вечно.
check('предел страниц останавливает обход',
    cf_has_next_sub(50, ['type' => 'offset', 'limit' => 50, 'max_pages' => 3], 2) === false);
check('без листания следующей порции нет', cf_has_next_sub(50, [], 0) === false);

// ─── Ссылка на вакансию из шаблона ──────────────────────────────────────────
// Сплошной rawurlencode превращал «/» в «%2F», и ссылка Lamoda ломалась: её
// slug состоит из двух сегментов пути.
check('slug из двух сегментов не ломается',
    cf_json_url(['slug' => 'moskva/frontend-vue-developer--1946'],
        ['url_template' => 'https://job.lamoda.ru/vacancy/{slug}'], 'https://job.lamoda.ru/')
    === 'https://job.lamoda.ru/vacancy/moskva/frontend-vue-developer--1946');

// При этом подставить чужой адрес по-прежнему нельзя: «?», «:» и «#» уходят
// в экранированном виде, и увести человека на другой хост не получится.
$evil = cf_json_url(['slug' => 'x?next=https://evil.ru'],
    ['url_template' => 'https://job.lamoda.ru/vacancy/{slug}'], 'https://job.lamoda.ru/');
check('чужой адрес через slug не подставить',
    str_starts_with($evil, 'https://job.lamoda.ru/vacancy/') && !str_contains($evil, '?next='));


// ─── Поля, на которых погорели на живых источниках ──────────────────────────

// У МТС город лежит как {id, documentId, title}: разбор искал только `name` и
// `@value`, и город терялся молча — карточка была без места работы.
check('имя берётся и из поля title', cf_name(['id' => 1, 'title' => 'Уфа']) === 'Уфа');
check('name важнее title', cf_name(['name' => 'Москва', 'title' => 'Уфа']) === 'Москва');
check('title работает и в списке объектов',
    cf_name([['id' => 1, 'title' => 'Бутово']]) === 'Бутово');

// Названия компании в ответе чаще всего нет вовсе, а в карточке «Wildberries»
// читается, «Карьерные страницы» — нет.
$wb = cf_json_items(
    ['items' => [['id' => 7, 'name' => 'пекарь-тандырщик'], ['id' => 8, 'name' => 'Буфетчик']]],
    ['list' => 'items', 'title' => 'name', 'id' => 'id',
     'company_const' => 'Wildberries',
     'url_template' => 'https://career.rwb.ru/vacancy/{id}'],
    'https://career.rwb.ru/', $now);
check('постоянное название компании проставилось',
    count($wb) === 2 && $wb[0]['company'] === 'Wildberries' && $wb[1]['company'] === 'Wildberries');
check('заголовок берётся из name, а не из категории',
    $wb[0]['title'] === 'пекарь-тандырщик');
check('ссылка собрана по шаблону',
    $wb[0]['url'] === 'https://career.rwb.ru/vacancy/7');

if ($failures) {
    echo "career feed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career feed: OK\n";
