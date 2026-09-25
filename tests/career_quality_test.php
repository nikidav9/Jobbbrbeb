<?php
// Карьерная выдача: мусор не проходит, вакансии не теряются.
//
// Правила собраны с живых страниц 25.09.2026 — Контур отдавал «Челябинск»
// ссылкой на фильтр по городу, у С-Терры все вакансии звались «Зеленоград»,
// у Норникеля к должности прилипала зарплата и дата. Проверяем обе стороны:
// мусор отсеян И настоящая должность, похожая на мусор, осталась. Второе
// важнее: лишняя карточка видна сразу, пропавшая вакансия — никогда.

require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Заголовок: мусор ─────────────────────────────────────────────────────────
foreach (['Челябинск', 'Ростов-на-Дону', 'Санкт-Петербург', 'Зеленоград', 'Иннополис',
          'Москва и область', 'Удалённо', '  Екатеринбург ', '«Новосибирск»'] as $t) {
    check("место «{$t}» — не вакансия", cq_title_problem($t) !== null);
}
foreach (['Кадровый резерв', 'Контакты для соискателей', 'Школьникам и абитуриентам',
          'Корпоративный университет', 'Написать нам', 'Руководителям', 'Все вакансии'] as $t) {
    check("раздел «{$t}» — не вакансия", cq_title_problem($t) !== null);
}
check('заголовок без букв — не вакансия', cq_title_problem('12 345 ₽') !== null);
check('пустой заголовок — не вакансия', cq_title_problem('   ') !== null);

// ── Заголовок: настоящие должности, похожие на мусор ─────────────────────────
foreach (['Комплектовщик (Выборг)', 'Бурильщик шпуров Норильск', 'Руководитель проекта',
          'Руководитель группы', 'Контактный центр: оператор', 'Разработчик C++',
          'Студент-стажёр в отдел аналитики', 'Стажёр-аналитик', 'Карьерный консультант',
          'Водитель', 'Повар', 'Продавец-кассир', 'Кладовщик', 'QA Engineer',
          'Менеджер по работе с ключевыми клиентами кластера (Красногорск)'] as $t) {
    check("«{$t}» остаётся вакансией", cq_title_problem($t) === null);
}

// ── Хвосты режутся, должность остаётся ───────────────────────────────────────
$tails = [
    'Бурильщик шпуров/ПУБР/Рудник "Скалистый" Норильск от 446 877 ₽ до вычета налогов 18.05.2026'
        => 'Бурильщик шпуров/ПУБР/Рудник "Скалистый" Норильск',
    'Cпециалист по продажам проектов 78 300 ₽' => 'Cпециалист по продажам проектов',
    'Оператор склада з/п по договоренности' => 'Оператор склада',
    'Руководитель/тимлид группы пресейл-инженеров Полная занятость Москва Более 6 лет'
        => 'Руководитель/тимлид группы пресейл-инженеров',
    'Кассир 45 000 руб.' => 'Кассир',
    'Водитель категории C' => 'Водитель категории C',
    'Инженер 1 категории' => 'Инженер 1 категории',
    'Оператор 5 разряда' => 'Оператор 5 разряда',
    // «з/п» внутри должности — не хвост.
    'Бухгалтер по з/п' => 'Бухгалтер по з/п',
    'Бухгалтер по расчёту з/п' => 'Бухгалтер по расчёту з/п',
    'Специалист по з/п и кадрам' => 'Специалист по з/п и кадрам',
    'Продавец з/п от 60 000' => 'Продавец',
];
foreach ($tails as $in => $want) {
    $got = cq_clean_title($in);
    check("хвост: «{$in}» → «{$want}», получено «{$got}»", $got === $want);
}

// ── Адрес ссылки ─────────────────────────────────────────────────────────────
check('фильтр по городу у Контура — не вакансия',
    cq_url_problem('https://kontur.ru/career/vacancies/city-6590') !== null);
check('подписка — не вакансия', cq_url_problem('https://x.ru/vacancies/subscribe/') !== null);
check('рекомендация друга — не вакансия', cq_url_problem('https://x.ru/vacancies/recommend') !== null);
check('резерв — не вакансия', cq_url_problem('https://x.ru/career/reserve/') !== null);
check('вакансия с номером — вакансия', cq_url_problem('https://kontur.ru/career/vacancies/5818') === null);
check('слаг city-manager — вакансия', cq_url_problem('https://x.ru/vacancy/city-manager') === null);
check('слаг contact-center-operator — вакансия',
    cq_url_problem('https://x.ru/vacancy/contact-center-operator-12') === null);
check('слаг regionalnyj-menedzher — вакансия',
    cq_url_problem('https://x.ru/vacancy/regionalnyj-menedzher') === null);

// ── Фильтр целиком: чистит заголовок, объясняет отказ ───────────────────────
$q = cf_quality_filter([
    ['title' => 'Оператор склада з/п по договоренности', 'url' => 'https://a.ru/vacancy/1'],
    ['title' => 'Челябинск', 'url' => 'https://a.ru/vacancies/city-6590'],
    ['title' => 'Повар', 'url' => 'https://a.ru/vacancy/2'],
    'не массив',
]);
check('годных две', count($q['kept']) === 2);
check('заголовок годной очищен', ($q['kept'][0]['title'] ?? '') === 'Оператор склада');
check('прочие поля годной не тронуты', ($q['kept'][0]['url'] ?? '') === 'https://a.ru/vacancy/1');
check('отказ один и с причиной', count($q['rejected']) === 1
    && ($q['rejected'][0]['why'] ?? '') === 'заголовок — название места');

// ── Порог: когда выдачу адреса не принимаем ──────────────────────────────────
check('ничего не пришло — не принимаем (перевёрстка)', cf_quality_rejects(0, 0));
check('пришли одни разделы — не принимаем', cf_quality_rejects(5, 0));
check('мусора больше, чем вакансий, и их меньше трёх — не принимаем', cf_quality_rejects(10, 2));
check('честные две из двух — принимаем', !cf_quality_rejects(2, 2));
check('честная одна из одной — принимаем', !cf_quality_rejects(1, 1));
check('три и больше — принимаем, даже с мусором', !cf_quality_rejects(57, 50));
check('ровно три из пяти — принимаем', !cf_quality_rejects(5, 3));
check('две настоящие и одна мусорная — принимаем (мусора не больше)', !cf_quality_rejects(3, 2));
check('одна настоящая и две мусорные — не принимаем', cf_quality_rejects(3, 1));

// ── Разбор ссылок: С-Терра — подзаголовок с городом не заголовок ─────────────
$now = 1_757_700_000;
$sterra = '<html><body>'
    . '<a class="vacancies-vacant__item" href="/company/rabota-u-nas/razrabotchik-c/">'
    . '<div class="vacancies-vacant__item__subtitle">Зеленоград</div>'
    . '<div class="vacancies-vacant__item__title">Разработчик  С/С++ (x86, mips, arm)</div></a>'
    . '<a class="vacancies-vacant__item" href="/company/rabota-u-nas/manager/">'
    . '<div class="vacancies-vacant__item__subtitle">Зеленоград</div>'
    . '<div class="vacancies-vacant__item__title">Менеджер в коммерческий отдел</div></a>'
    . '</body></html>';
$rows = cf_html_links($sterra, 'https://www.s-terra.ru/company/rabota-u-nas',
    ['link_path' => '/company/rabota-u-nas/', 'min_title' => 8], $now);
$titles = array_column($rows, 'title');
check('С-Терра: должность вместо города', $titles === ['Разработчик С/С++ (x86, mips, arm)', 'Менеджер в коммерческий отдел']);

// Город в заголовке-кандидате, а должность — в соседнем элементе с «name».
$fallback = '<a href="/vacancy/7"><h3>Москва</h3><span class="job-name">Кладовщик-комплектовщик</span></a>';
$rows = cf_html_links($fallback, 'https://b.ru/', ['link_path' => '/vacancy/'], $now);
check('если первый кандидат — город, берётся следующий',
    ($rows[0]['title'] ?? '') === 'Кладовщик-комплектовщик');

// ── Контур целиком через тот же фильтр, что в бою ────────────────────────────
$kontur = '<html><body>'
    . '<a href="/career/vacancies/5818">Ведущий data scientist по ИИ-агентам, senior</a>'
    . '<a href="/career/vacancies/3728">Руководитель команды разработки</a>'
    . '<a href="/career/vacancies/655">Системный аналитик, middle+/senior</a>'
    . '<a href="/career/vacancies/city-6590">Челябинск</a>'
    . '<a href="/career/vacancies/city-5457">Екатеринбург</a>'
    . '</body></html>';
$raw = cf_html_links($kontur, 'https://kontur.ru/career/vacancies', ['link_path' => '/vacancies/', 'min_title' => 8], $now);
$q = cf_quality_filter($raw);
check('Контур: города отсеяны, вакансии на месте',
    array_column($q['kept'], 'title') === ['Ведущий data scientist по ИИ-агентам, senior',
        'Руководитель команды разработки', 'Системный аналитик, middle+/senior']);
check('Контур: выдача принимается', !cf_quality_rejects(count($raw), count($q['kept'])));

// ── Фильтр стоит там, где его видят и сбор, и разведка ──────────────────────
$unit = (string)file_get_contents(__DIR__ . '/../php-proxy/career_unit.php');
$career = (string)file_get_contents(__DIR__ . '/../php-proxy/career.php');
check('cf_fetch_unit отдаёт только прошедшее фильтр',
    str_contains($unit, '$q = cf_quality_filter($items);')
    && str_contains($unit, "'items' => \$q['kept']"));
check('career.php не принимает выдачу по порогу и называет причину',
    str_contains($career, "if (\$sub === 0 && cf_quality_rejects(")
    && str_contains($career, "\$skipUnit('мало настоящих вакансий: '"));

// ── Каталог: одна вакансия — один адрес ──────────────────────────────────────
// Сайт, у которого есть API, не должен одновременно читаться ссылками: у
// одной вакансии получались два разных номера и две карточки в ленте (так
// было у X5 Tech, Селектела и Авиасейлса). И два адреса, отличающиеся одной
// косой чертой, — это один и тот же список, прочитанный дважды.
$catalog = json_decode((string)file_get_contents(__DIR__ . '/../scripts/career-endpoints.json'), true);
$quarantine = json_decode((string)file_get_contents(__DIR__ . '/../scripts/career-runtime-quarantine.json'), true);
check('каталог читается', is_array($catalog) && count($catalog) > 20);
$quarantined = array_column(is_array($quarantine) ? $quarantine : [], 'url');
$host = fn(string $u): string => preg_replace('~^www\.~', '', strtolower((string)parse_url($u, PHP_URL_HOST)));
$apiHosts = [];
$seen = [];
foreach ($catalog as $e) {
    $mode = $e['mode'] ?? 'json';
    $key = $mode . '|' . rtrim((string)$e['url'], '/');
    check("адрес не повторяется: {$e['url']}", !isset($seen[$key]));
    $seen[$key] = true;
    // API в боевом карантине сайт не обслуживает: у Авиасейлса он с
    // московского сервера отвечает 404, и живы его вакансии только ссылками.
    if ($mode !== 'html_links' && !in_array($e['url'], $quarantined, true)) {
        $apiHosts[$host((string)($e['map']['url_template'] ?? $e['url']))] = $e['url'];
    }
}
foreach ($catalog as $e) {
    if (($e['mode'] ?? 'json') !== 'html_links') continue;
    $h = $host((string)$e['url']);
    check("сайт {$h} читается и API, и ссылками", !isset($apiHosts[$h]));
}
$kontur = array_values(array_filter($catalog, fn($e) => ($e['url'] ?? '') === 'https://kontur.ru/career/vacancies'));
check('у Контура ссылки только на вакансии с номером',
    ($kontur[0]['map']['link_regex'] ?? '') === '~^/career/vacancies/[0-9]+/?$~');
// Выкладка (infra/sync-career-catalog.sh) гасит вакансии компании из
// карантина, если у неё нет здорового адреса С company_hint. Без подсказки
// рабочий API МТС, VK, Lamoda считался отсутствующим, и каждая выкладка
// гасила их вакансии до следующего сбора.
foreach ($catalog as $e) {
    $c = (string)($e['map']['company_const'] ?? '');
    if ($c === '' || in_array($e['url'], $quarantined, true)) continue;
    check("у здорового адреса {$c} есть company_hint ({$e['url']})", ($e['company_hint'] ?? '') !== '');
}
check('Авиасейлс читается ссылками, пока его API в карантине',
    count(array_filter($catalog, fn($e) => ($e['url'] ?? '') === 'https://www.aviasales.ru/about/vacancies')) === 1);
foreach (['https://www.rusal.ru/career/vacancies', 'https://www.ispring.ru/company/jobs/vacancies',
          'https://careers.just-ai.com/vakansii', 'https://www.amocrm.ru/jobs', 'https://petrovichjob.ru'] as $u) {
    check("страница разделов {$u} в карантине, разведка её не вернёт", in_array($u, $quarantined, true));
}

if ($failures) {
    echo "career quality: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career quality: OK\n";
