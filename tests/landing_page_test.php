<?php
// Проверка сводных страниц: «работа комплектовщиком в Москве» и по станции.
//
// Ценность этих страниц не в списке вакансий — список есть у всех, — а в том,
// что мы посчитали сами: сколько открыто и в какой вилке платят. Если счёт
// врёт, страница хуже, чем её отсутствие. Поэтому проверяем цифры, а не то,
// что страница «отрисовалась».
//
// База подменяется заглушкой: sb_lite.php обёрнут в if (!function_exists('sb')).

$GLOBALS['TABLES'] = [];
function sb(string $m, string $t, array $q = [], $b = null, array $e = []): array { return []; }
function sb_single(string $t, array $f = [], string $sel = '*'): ?array { return null; }
function sb_update(string $t, array $f, array $d): void {}
function sb_upsert_rows(string $t, array $r, string $c): void {}
function sb_insert(string $t, array $r): void {}
function now_iso(): string { return gmdate('c'); }
function sb_lite_url(): string { return 'https://jobtoo.ru'; }
function sb_lite_key(): string { return 'test'; }

/** Заглушка выборки: отдаёт строки таблицы, отфильтрованные по eq./is. */
function sb_select(string $t, array $f = [], string $sel = '*'): array
{
    $rows = $GLOBALS['TABLES'][$t] ?? [];
    foreach ($f as $col => $cond) {
        if (str_starts_with((string)$cond, 'eq.')) {
            $want = substr((string)$cond, 3);
            $rows = array_values(array_filter($rows, fn($r) => (string)($r[$col] ?? '') === $want));
        } elseif ((string)$cond === 'is.true') {
            $rows = array_values(array_filter($rows, fn($r) => !empty($r[$col])));
        }
    }
    return $rows;
}
function sb_select_all(string $t, array $f = [], string $sel = '*'): array { return sb_select($t, $f, $sel); }

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

define('LANDING_PAGE_LIB_ONLY', true);
require __DIR__ . '/../php-proxy/landing_page.php';

// ── Перевод названия станции в адрес ──────────────────────────────────────────
check('обычная станция', lp_slug('Алтуфьево') === 'altufevo');
check('две части через дефис', lp_slug('Улица 1905 года') === 'ulitsa-1905-goda');
check('буква ё', lp_slug('Тёплый Стан') === 'teplyy-stan');
check('мягкий знак выпадает', lp_slug('Пушкинская') === 'pushkinskaya');
check('лишние дефисы схлопываются', lp_slug('  Парк   Победы  ') === 'park-pobedy');
check('адрес годится для nginx', (bool)preg_match('/^[a-z0-9-]+$/', lp_slug('Щёлковская')));

// ── Склонение ─────────────────────────────────────────────────────────────────
check('1 вакансия', lp_plural(1, 'вакансия', 'вакансии', 'вакансий') === '1 вакансия');
check('2 вакансии', lp_plural(2, 'вакансия', 'вакансии', 'вакансий') === '2 вакансии');
check('5 вакансий', lp_plural(5, 'вакансия', 'вакансии', 'вакансий') === '5 вакансий');
check('11 вакансий', lp_plural(11, 'вакансия', 'вакансии', 'вакансий') === '11 вакансий');
check('21 вакансия', lp_plural(21, 'вакансия', 'вакансии', 'вакансий') === '21 вакансия');
check('112 вакансий', lp_plural(112, 'вакансия', 'вакансии', 'вакансий') === '112 вакансий');

// ── Вилка оплаты ──────────────────────────────────────────────────────────────
$line = lp_salary_line([['salary' => 3000.0], ['salary' => 5000.0], ['salary' => 4000.0]]);
check('вилка от и до', str_contains($line, '3 000') && str_contains($line, '5 000'));
check('середина посчитана', str_contains($line, '4 000'));
check('без зарплат строки нет', lp_salary_line([['salary' => 0.0]]) === '');
check('одна цена — без вилки', !str_contains(lp_salary_line([['salary' => 3000.0], ['salary' => 3000.0]]), 'от'));

// ── Данные ────────────────────────────────────────────────────────────────────
$own = [];
for ($i = 0; $i < 2; $i++) {
    $own[] = ['id' => "own-$i", 'title' => 'Комплектовщик', 'company' => 'Склад Альфа',
        'metro_station' => 'Алтуфьево', 'salary' => 3500, 'status' => 'open', 'work_type' => 'picker'];
}
$ext = [];
for ($i = 0; $i < 6; $i++) {
    $ext[] = ['id' => "ext-$i", 'title' => 'Комплектовщик на склад', 'company' => 'ООО Бета',
        'metro_station' => $i < 4 ? 'Алтуфьево' : 'Медведково', 'salary' => 4000,
        'pay_period' => 'shift', 'url' => 'https://hh.ru/vacancy/1', 'active' => true, 'work_type' => 'picker'];
}
// Мало вакансий — страницы быть не должно.
$ext[] = ['id' => 'ext-cook', 'title' => 'Повар', 'company' => 'Кафе', 'metro_station' => 'Тверская',
    'salary' => 3000, 'pay_period' => 'shift', 'url' => 'https://hh.ru/vacancy/2',
    'active' => true, 'work_type' => 'cook'];

$GLOBALS['TABLES'] = ['jm_vacancies' => $own, 'jm_ext_vacancies' => $ext];

function render_page(string $work, string $station = ''): string
{
    ob_start();
    lp_render($work, $station);
    return (string)ob_get_clean();
}

// ── Страница профессии по городу ──────────────────────────────────────────────
$html = render_page('komplektovshchik');
check('заголовок про профессию', str_contains($html, 'Работа комплектовщиком в Москве'));
// 2 своих + 6 партнёрских = 8. Число считается, а не берётся с потолка.
check('посчитаны все вакансии', str_contains($html, '8 вакансий'));
check('отмечены свои', str_contains($html, '2 вакансии') && str_contains($html, 'напрямую у нас'));
check('вилка оплаты показана', str_contains($html, '3 500') && str_contains($html, '4 000'));
check('есть канонический адрес', str_contains($html, 'rel="canonical"'));
check('ссылка на свою вакансию внутренняя', str_contains($html, 'https://jobtoo.ru/s/own-0'));
check('партнёрская ведёт к источнику', str_contains($html, 'https://hh.ru/vacancy/1'));
// Перелинковка: станция с 6 вакансиями есть, с 2 — нет.
check('станция выше порога в перелинковке', str_contains($html, '/rabota/komplektovshchik/altufevo'));
check('станция ниже порога не предлагается', !str_contains($html, 'medvedkovo'));

// ── Страница профессии по станции ─────────────────────────────────────────────
$html = render_page('komplektovshchik', 'altufevo');
check('заголовок со станцией', str_contains($html, 'у метро Алтуфьево'));
check('счёт только по станции', str_contains($html, '6 вакансий'));
check('канонический адрес со станцией', str_contains($html, '/rabota/komplektovshchik/altufevo"'));
check('есть ссылка на город', str_contains($html, '/rabota/komplektovshchik"'));

// ── Порог ─────────────────────────────────────────────────────────────────────
// Ниже порога страницы нет вовсе: тонкая страница без содержания понижает
// весь сайт, а не только себя.
$thrown = false;
ob_start();
try { lp_render('povar', ''); } catch (LpNotFound $e) { $thrown = true; }
ob_end_clean();
check('страница ниже порога не отдаётся', $thrown);

$thrown = false;
ob_start();
try { lp_render('komplektovshchik', 'takoy-stantsii-net'); } catch (LpNotFound $e) { $thrown = true; }
ob_end_clean();
check('несуществующая станция не отдаётся', $thrown);

// ── Перечень для карты сайта ──────────────────────────────────────────────────
$index = lp_index();
check('город комплектовщика в перечне', in_array('/rabota/komplektovshchik', $index, true));
check('станция выше порога в перечне', in_array('/rabota/komplektovshchik/altufevo', $index, true));
check('станция ниже порога не в перечне', !in_array('/rabota/komplektovshchik/medvedkovo', $index, true));
check('повар ниже порога не в перечне', !in_array('/rabota/povar', $index, true));
foreach ($index as $u) {
    check("адрес $u годится для nginx", (bool)preg_match('~^/rabota/[a-z-]{1,40}(/[a-z0-9-]{1,80})?$~', $u));
}

// ── Экранирование ─────────────────────────────────────────────────────────────
$GLOBALS['TABLES']['jm_ext_vacancies'][0]['title'] = 'Грузчик <script>alert(1)</script>';
$html = render_page('komplektovshchik');
check('теги в названии экранированы', !str_contains($html, '<script>alert(1)</script>'));

// ── Где работа: станция, а если её нет — адрес ────────────────────────────────
// Страница про место не должна оставлять карточку без места. У партнёрских
// вакансий станция заполнена далеко не всегда, и без запасного варианта
// человек видел «ООО Бета · 4 000 ₽ за смену» и ни намёка, куда ехать.
check('станция в приоритете',
    lp_place(['metro' => 'Алтуфьево', 'place' => 'ул. Складская, 4'], '') === 'м. Алтуфьево');
check('без станции показываем адрес',
    lp_place(['metro' => '', 'place' => 'Химки, Ленинградское шоссе, 1'], '') === 'Химки, Ленинградское шоссе, 1');
check('нет ни того ни другого — пусто',
    lp_place(['metro' => '', 'place' => ''], '') === '');
check('на странице станции место не повторяем',
    lp_place(['metro' => 'Алтуфьево', 'place' => 'ул. Складская, 4'], 'altufevo') === '');
// Адрес бывает длиной в строку целиком, а это подпись под названием.
$long = lp_place(['metro' => '', 'place' => str_repeat('Очень длинный адрес, ', 6)], '');
check('длинный адрес обрезан', mb_strlen($long, 'UTF-8') <= 48 && str_ends_with($long, '…'));

// Заглушка sb_select список колонок игнорирует, поэтому отрисовка прошла бы и
// с незапрошенным из базы адресом — а в бою его бы не было. Сверяем запрос.
$src = (string)file_get_contents(__DIR__ . '/../php-proxy/landing_page.php');
check('адрес своих вакансий запрашивается',
    str_contains($src, "'id,title,company,metro_station,salary,address'"));
check('адрес партнёрских вакансий запрашивается',
    str_contains($src, "'id,title,company,metro_station,address,salary,pay_period,url'"));

// И то же самое на настоящей отрисовке, а не только в функции.
$GLOBALS['TABLES']['jm_ext_vacancies'][5]['metro_station'] = '';
$GLOBALS['TABLES']['jm_ext_vacancies'][5]['address'] = 'Химки, Ленинградское шоссе, 1';
$html = render_page('komplektovshchik');
check('адрес виден в списке', str_contains($html, 'Химки, Ленинградское шоссе, 1'));

if ($failures) {
    echo "landing pages: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "landing pages: OK\n";
