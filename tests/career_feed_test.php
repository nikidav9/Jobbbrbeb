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

// ─── http-ссылка на свой же хост ────────────────────────────────────────────
// У Детского мира все двенадцать вакансий — «кладовщик», «комплектовщик
// товара», «упаковщик», ровно наша аудитория — проставлены через http, при том
// что по https та же страница открывается. Без подъёма схемы работодатель
// терялся целиком.
check('http на свой хост поднимается до https',
    cf_json_url(['href' => 'http://jobs.detmir.ru/logistics/komplektovshchik-tovara'],
        ['url' => 'href'], 'https://jobs.detmir.ru')
    === 'https://jobs.detmir.ru/logistics/komplektovshchik-tovara');

// А вот чужой http-адрес так и остаётся отброшенным: подставлять в ленту
// ссылку на постороннюю незащищённую страницу мы не должны.
check('чужой http-адрес отбрасывается',
    cf_json_url(['href' => 'http://evil.ru/vacancy/1'],
        ['url' => 'href'], 'https://jobs.detmir.ru') === '');

// И подъём не работает, когда сама страница-источник по http: тогда совпадение
// хоста ничего не гарантирует.
check('с http-страницы схему не поднимаем',
    cf_json_url(['href' => 'http://jobs.detmir.ru/dm/kladovschik'],
        ['url' => 'href'], 'http://jobs.detmir.ru') === '');


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


// ─── Вакансии, выложенные обычными ссылками ─────────────────────────────────
// Третий вид источника. Замерено по 111 карьерным сайтам: разметку JobPosting
// держат двое, JSON отдают немногие, а список ссылок лежит у двух десятков.
// Все случаи ниже — с живых страниц, каждый когда-то пролезал в ленту.

$linkPage = function (array $links): string {
    $html = '<html><body><div class="list">';
    foreach ($links as [$href, $inner]) $html .= '<a href="' . $href . '">' . $inner . '</a>';
    return $html . '</div></body></html>';
};
$lp = ['link_path' => '/vacancy/', 'company' => 'Тест'];
$base = 'https://job.example.ru/vacancies';

$items = cf_html_links($linkPage([
    ['/vacancy/123', 'Комплектовщик на склад'],
    ['/vacancy/124', 'Повар-универсал'],
]), $base, $lp, $now);
check('ссылки на вакансии разобраны', count($items) === 2);
check('адрес достроен от страницы', $items[0]['url'] === 'https://job.example.ru/vacancy/123');
check('название компании проставлено', $items[0]['company'] === 'Тест');

// Ссылка на сам раздел, а не на вакансию: после `/vacancy/` ничего нет.
// Через это в ленту лезли «Все города» у СИБУРа и «Все направления» у МегаФона.
// Текст нарочно выглядит должностью: правило должно сработать по АДРЕСУ, а не
// по словам. С «Все вакансии» мутация проходила мимо — её ловил список
// пустышек, а не эта проверка.
check('ссылка на раздел отброшена',
    cf_html_links($linkPage([['/vacancy/', 'Комплектовщик на склад']]), $base, $lp, $now) === []);
check('ссылка на раздел с хвостовым слэшем тоже отброшена',
    cf_html_links($linkPage([['/vacancy//', 'Оператор линии']]), $base, $lp, $now) === []);
check('а ссылка с номером принимается',
    count(cf_html_links($linkPage([['/vacancy/77', 'Комплектовщик на склад']]), $base, $lp, $now)) === 1);

// Слова-пустышки: ссылка есть, должности в ней нет. «Подробнее» у Протея,
// «Показать все (10)» у Иви, «Кандидатам» у Контура.
foreach (['Подробнее', 'Показать все (10)', 'Кандидатам', 'Наши вакансии',
          'согласие на обработку данных'] as $noise) {
    check("пустышка отброшена: $noise",
        cf_html_links($linkPage([['/vacancy/9', $noise]]), $base, $lp, $now) === []);
}

// Голый textContent склеивал вложенные элементы: у VK выходило
// «Бизнес-ассистентДзенМосква», у Иви метки технологий липли перед должностью.
$glued = cf_html_links($linkPage([
    ['/vacancy/7', '<h3>Бизнес-ассистент</h3><span>Дзен</span><span>Москва</span>'],
]), $base, $lp, $now);
check('заголовок берётся из h3, а не склейкой',
    count($glued) === 1 && $glued[0]['title'] === 'Бизнес-ассистент');

$byClass = cf_html_links($linkPage([
    ['/vacancy/8', '<div class="card__title">Оператор склада</div><div>Москва</div>'],
]), $base, $lp, $now);
check('заголовок берётся из элемента с title в классе',
    count($byClass) === 1 && $byClass[0]['title'] === 'Оператор склада');

$plain = cf_html_links($linkPage([
    ['/vacancy/9', '<span>Кладовщик</span><span>Химки</span>'],
]), $base, $lp, $now);
check('без заголовка куски разделяются пробелом',
    count($plain) === 1 && $plain[0]['title'] === 'Кладовщик Химки');

// Одна вакансия часто висит двумя ссылками — с картинки и с заголовка.
$twice = cf_html_links($linkPage([
    ['/vacancy/55', '<img> Грузчик на склад'],
    ['/vacancy/55', 'Грузчик на склад'],
]), $base, $lp, $now);
check('вакансия не задваивается двумя ссылками', count($twice) === 1);

check('слишком короткий текст за должность не считаем',
    cf_html_links($linkPage([['/vacancy/1', 'Топ']]), $base, $lp, $now) === []);
check('без link_path ничего не разбираем',
    cf_html_links($linkPage([['/vacancy/1', 'Комплектовщик']]), $base, [], $now) === []);


// ─── Найдено уже на проде, после выката ─────────────────────────────────────

// У Яндекса все 68 «вакансий» оказались ссылками /jobs/vacancies?profession=…
// — это фильтры каталога, а заголовком шло «Разработка», «Аналитика».
check('ссылка-фильтр на раздел отброшена',
    cf_html_links('<a href="/jobs/vacancies?profession=backend">Разработка в Яндексе</a>',
        'https://yandex.ru/jobs/vacancies', ['link_path' => '/jobs/'], $now) === []);
check('а обычная вакансия рядом принимается',
    count(cf_html_links('<a href="/jobs/12345">Комплектовщик склада</a>',
        'https://yandex.ru/jobs/vacancies', ['link_path' => '/jobs/'], $now)) === 1);

// В карточке Ростелекома стояло «Технический блок» — это направление, а не
// работодатель: поле из ответа перебивало постоянное название.
$rt = cf_json_items(
    ['vacancies' => [['id' => 1, 'name' => 'Бригадир монтажников',
                      'directions' => [['id' => 4, 'name' => 'Технический блок']]]]],
    ['list' => 'vacancies', 'title' => 'name', 'id' => 'id', 'company' => 'directions',
     'company_const' => 'Ростелеком', 'url_template' => 'https://job.rt.ru/vacancy/{id}'],
    'https://job.rt.ru/', $now);
check('постоянное название компании сильнее поля из ответа',
    count($rt) === 1 && $rt[0]['company'] === 'Ростелеком');

// Источники по ссылкам берут название оттуда же, иначе в карточке пусто.
$hl = cf_html_links('<a href="/vacancy/9">Оператор склада</a>', 'https://x.ru/vacancy',
    ['link_path' => '/vacancy/', 'company_const' => 'Техвилл'], $now);
check('источник по ссылкам тоже знает название компании',
    count($hl) === 1 && $hl[0]['company'] === 'Техвилл');


// Найдено сплошной проверкой на проде: в ленту шли счётчики и разделы.
foreach (['2 вакансии', '17 вакансий', 'Рекомендовать друга', 'Разработчикам'] as $junk) {
    check("не вакансия отброшена: $junk",
        cf_html_links('<a href="/vacancy/1">' . $junk . '</a>', 'https://x.ru/v',
            ['link_path' => '/vacancy/'], $now) === []);
}
check('должность с числом в начале не пострадала',
    count(cf_html_links('<a href="/vacancy/1">3D-художник в команду</a>', 'https://x.ru/v',
        ['link_path' => '/vacancy/'], $now)) === 1);


// ─── Состояние, встроенное в разметку ───────────────────────────────────────
// Так отдают вакансии VK (25), ВТБ (20), Островок, Кофемания, Хоулмонт: никакого
// отдельного запроса за ними нет, всё приезжает первой же страницей.

$next = '<html><body><script id="__NEXT_DATA__" type="application/json">'
    . '{"props":{"pageProps":{"vacancies":[{"id":7,"title":"Комплектовщик"}]}}}'
    . '</script></body></html>';
check('состояние Next.js прочитано',
    cf_embedded_state($next)['props']['pageProps']['vacancies'][0]['title'] === 'Комплектовщик');

$nuxt = '<html><body><script>window.__NUXT__ = {"data":[{"title":"Повар"}]};</script></body></html>';
check('состояние Nuxt прочитано', cf_embedded_state($nuxt)['data'][0]['title'] === 'Повар');

check('без состояния возвращается null', cf_embedded_state('<html><body>Вакансий нет</body></html>') === null);
check('битый JSON не роняет разбор',
    cf_embedded_state('<script id="__NEXT_DATA__">{сломано</script>') === null);

// Разбор состояния и разбор ответа API — одна и та же дорога: cf_json_items.
$vk = cf_json_items(cf_embedded_state($next),
    ['list' => 'props.pageProps.vacancies', 'title' => 'title', 'id' => 'id',
     'company_const' => 'VK', 'url_template' => 'https://team.vk.company/vacancy/{id}'],
    'https://team.vk.company/vacancy', $now);
check('вакансия из встроенного состояния разобрана',
    count($vk) === 1 && $vk[0]['title'] === 'Комплектовщик'
    && $vk[0]['url'] === 'https://team.vk.company/vacancy/7' && $vk[0]['company'] === 'VK');

// ── Шаг обхода: упавший адрес не должен рушить весь источник ──────────────
//
// Это главная проверка всего файла. На проде обход раздела «Работа» стоял
// намертво: ingest.php на ошибочный ответ прекращает заход ЦЕЛИКОМ и оставляет
// в контрольной точке тот самый адрес, а стирает её только после полного
// успешного круга. Первый же адрес в списке отвечал 404 — и тридцать три
// компании не обходились вовсе.

// Обычный ход: есть ещё порции — дочитываем текущий адрес.
check('есть порции — следующий sub того же адреса',
    cf_next_step(3, 1, 10, true, false) === ['page' => 3, 'sub' => 2]);

// Порции кончились — следующий работодатель, порции считаем с нуля.
check('порции кончились — следующий адрес с нулевой порции',
    cf_next_step(3, 7, 10, false, false) === ['page' => 4, 'sub' => 0]);

// Конец списка — обход закончен.
check('последний адрес — обход закончен', cf_next_step(9, 0, 10, false, false) === null);

// Ради чего всё: упавший адрес пропускаем и идём дальше, а не встаём.
check('упавший адрес — переходим к следующему',
    cf_next_step(0, 0, 33, false, true) === ['page' => 1, 'sub' => 0]);

// И не дочитываем его порции: не ответил адрес — не ответит и вторая страница.
check('у упавшего адреса порции не дочитываем',
    cf_next_step(0, 3, 33, true, true) === ['page' => 1, 'sub' => 0]);

// Упал последний — обход всё равно закончен, а не зациклен.
check('упал последний адрес — обход закончен',
    cf_next_step(32, 0, 33, true, true) === null);

// Приёмник обязан уметь не гасить вакансии после неполного круга.
$ingest = file_get_contents(__DIR__ . '/../php-proxy/ingest.php');
check('неполный круг не гасит свежие вакансии',
    str_contains($ingest, "\$cut = \$partial ? gmdate('Y-m-d\\TH:i:s\\Z', time() - STALE_MAX_DAYS * 86400) : \$startedAt;"));
// Обратная сторона пощады: пока хоть один работодатель отвечает 403, круг
// всегда неполный — и без предела по возрасту заполненная вакансия висела бы
// вечно, а человек получал бы 404. Ровно то, за что владелец ругал Сбера.
check('вакансия, которой не видно неделю, гаснет и на неполном круге',
    str_contains($ingest, 'const STALE_MAX_DAYS = 7;')
    && str_contains($ingest, "'last_seen_at' => 'lt.' . \$cut,"));
check('неполный круг виден в статусе источника',
    str_contains($ingest, "\$partial ? 'ок, не весь'"));
check('признак неполноты переживает перерыв на контрольной точке',
    str_contains($ingest, "'partial' => \$partial,")
    && str_contains($ingest, "\$partial = !empty(\$saved['partial']);"));

// Упавший адрес обязан выйти ответом-пропуском, а не ошибкой: ошибочный ответ
// приёмник понимает как обрыв захода.
$career = file_get_contents(__DIR__ . '/../php-proxy/career.php');
check('недоступная страница пропускается, а не рушит обход',
    str_contains($career, '$skipUnit("страница недоступна ($code $error)");')
    && !str_contains($career, "cf_fail(502, \"страница недоступна"));
check('ответ-пропуск помечен partial',
    str_contains($career, "\$out['partial'] = true;"));
check('проверка безопасности адреса осталась перед походом',
    str_contains($career, 'if (!ing_safe_https_url($pageUrl))')
    && str_contains($career, '$resolveEntries = ing_safe_https_resolve($pageUrl);'));
check('увод на непубличный адрес по-прежнему не разбирается',
    str_contains($career, "\$skipUnit('страница увела на непубличный адрес');"));

// ── Описание со страницы вакансии ─────────────────────────────────────────
//
// В ленте стояло «Источник не прислал описания» у 858 вакансий из 1583: в
// списке описания почти нигде нет, оно живёт на странице самой вакансии.

$jobPosting = '<html><body><script type="application/ld+json">'
    . json_encode(['@type' => 'JobPosting', 'title' => 'Продавец',
        'description' => '<p>' . str_repeat('Работа в магазине рядом с домом. ', 4) . '</p>'],
        JSON_UNESCAPED_UNICODE)
    . '</script></body></html>';
check('описание берётся из разметки JobPosting',
    str_starts_with(cf_page_description($jobPosting), 'Работа в магазине рядом с домом.'));
check('разметку очищаем от тегов', !str_contains(cf_page_description($jobPosting), '<p>'));

$meta = '<html><head><meta name="description" content="'
    . str_repeat('Ищем кассира в магазин у дома. ', 4) . '"></head><body></body></html>';
check('без разметки берём описание для поисковой выдачи',
    str_starts_with(cf_page_description($meta), 'Ищем кассира в магазин у дома.'));

$og = '<html><head><meta property="og:description" content="'
    . str_repeat('Смена восемь часов, выплаты еженедельно. ', 3) . '"></head><body></body></html>';
check('og:description тоже годится',
    str_starts_with(cf_page_description($og), 'Смена восемь часов, выплаты еженедельно.'));

// Запасной путь. Он самый опасный: на замере по 23 работодателям приносил у
// BSL политику конфиденциальности, а у kokos group — форму отклика.
// Меню и подвал кладём ВНУТРЬ выбранного контейнера: снаружи они и так не
// попали бы, и мутация «не выбрасывать служебные узлы» оставалась зелёной.
$plain = '<html><body><main><nav>Главная Вакансии Контакты</nav><p>'
    . str_repeat('Обязанности: принимать товар, работать с кассой. ', 6)
    . '</p><footer>Политика сайта, карта сайта, реквизиты</footer></main></body></html>';
$got = cf_page_description($plain);
check('без разметки и meta берём самый длинный кусок текста',
    str_contains($got, 'Обязанности: принимать товар'));
check('меню и подвал в описание не попадают',
    !str_contains($got, 'Контакты') && !str_contains($got, 'реквизиты'));

$policy = '<html><body><main><p>'
    . str_repeat('Политика конфиденциальности определяет порядок обработки данных. ', 6)
    . '</p></main></body></html>';
check('политика конфиденциальности за описание не выдаётся', cf_page_description($policy) === '');

// В тексте формы намеренно НЕТ слов, которые ловит отсев: иначе проверка
// проходила бы и без выбрасывания самой формы.
$form = '<html><body><main><form><p>'
    . str_repeat('Имя, фамилия, телефон, город, желаемая должность, дата выхода. ', 6)
    . '</p></form></main></body></html>';
check('форма отклика за описание не выдаётся', cf_page_description($form) === '');

check('пустая страница описания не даёт', cf_page_description('') === '');
check('короткий обрывок лучше не показывать',
    cf_page_description('<html><body><main>Вакансия</main></body></html>') === '');
// Отдельно — обрывок, дошедший до запасного пути по div: предел длины стоит в
// двух местах, и без этой пары мутация «снять второй» оставалась зелёной.
check('короткий обрывок не проходит и запасным путём',
    cf_page_description('<html><body><div>' . str_repeat('Нужен кассир. ', 6)
        . '</div></body></html>') === '');

// У части сайтов нет ни main, ни article, ни section — у Just AI на 71 div ни
// одного. Такие страницы тоже должны отдавать описание.
$divs = '<html><body><div><div>' . str_repeat('Мы команда разработки платформы. ', 8)
    . '</div></div></body></html>';
check('страница на одних div описание всё равно отдаёт',
    str_contains(cf_page_description($divs), 'Мы команда разработки платформы'));

// ── Сборщик: добор описаний ───────────────────────────────────────────────
$ingest = file_get_contents(__DIR__ . '/../php-proxy/ingest.php');
check('описания добираются только у карьерных источников',
    str_contains($ingest, "if ((\$src['connector_kind'] ?? '') === 'career') {")
    && str_contains($ingest, '$described += ing_fill_descriptions($rows, $deadline);'));
check('добор укладывается в общий бюджет захода',
    str_contains($ingest, 'if (microtime(true) >= $deadline) break;'));
check('за описанием не ходим, если источник его прислал',
    str_contains($ingest, "if (trim((string)(\$row['description'] ?? '')) !== '') continue;"));
// Страница вакансии — чужой адрес. Сторожа те же, что у остального обхода.
check('страница вакансии проходит проверку адреса',
    str_contains($ingest, 'if ($url === \'\' || !ing_safe_https_url($url)) return null;')
    && str_contains($ingest, '$resolveEntries = ing_safe_https_resolve($url);'));
check('за редиректом со страницы вакансии не идём',
    str_contains($ingest, 'CURLOPT_FOLLOWLOCATION => false'));
check('адрес, к которому пришли, проверяется повторно',
    str_contains($ingest, 'CURLINFO_PRIMARY_IP')
    && str_contains($ingest, 'FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE'));
check('размер страницы вакансии ограничен',
    str_contains($ingest, '$tooLarge = true; return 0;'));

if ($failures) {
    echo "career feed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career feed: OK\n";
