<?php
// В ленту попадают только вакансии, которые мы умеем отнести к своему виду работ.
//
// Что чинится. hh-адаптер запрашивал всю Москву без фильтра по профессии,
// ing_work_type возвращал null для всего, что не склад и не кухня, — но строка
// с null всё равно писалась в базу, а на выдаче в ленту фильтра по профессии
// нет вовсе. Человеку, который ищет смену, приложение показывало бухгалтеров и
// Java-разработчиков. Это и есть ответ на «2000+ вакансий за сутки — ноль
// откликов»: не мало вакансий, а не те.
//
// Проверка работает на настоящей production-нормализации: INGEST_LIBRARY_ONLY
// гасит точку входа, сети и базы здесь нет.
define('INGEST_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/ingest.php';

$failures = [];
function check(string $name, bool $ok): void {
    global $failures;
    if (!$ok) $failures[] = $name;
}

/** Минимальная годная вакансия: три обязательных поля плюс то, что проверяем. */
function item(string $title, ?string $workType = null): array {
    $it = ['id' => 'x1', 'title' => $title, 'url' => 'https://example.org/v/1'];
    if ($workType !== null) $it['work_type'] = $workType;
    return $it;
}

// ── Подработка: профессия обязательна ────────────────────────────────────────
// Ровно те названия, которые приезжали из hh и занимали ленту смен.
foreach (['Ведущий разработчик Java', 'Главный бухгалтер', 'Юрист',
          'Бизнес-ассистент операционного директора', 'Менеджер по продажам'] as $t) {
    check("в подработку не берём: $t", ing_normalize(item($t), 'src') === null);
}

// ── «Работа»: там же названия — товар, а не мусор ─────────────────────────────
// У сервиса два раздела с разными законами. Требовать от постоянной вакансии
// work_type из складского списка значит выбросить весь раздел: ни Arbihunter,
// ни карьерные страницы в четыре вида работ не укладываются и не должны.
foreach (['Ведущий разработчик Java', 'Head Media Buyer', 'Retention Manager',
          'Middle Automation Engineer', 'Юрист'] as $t) {
    $row = ing_normalize(item($t) + ['kind' => 'permanent'], 'src');
    check("в «Работу» берём: $t", $row !== null);
    check("вид работ у постоянной может быть пустым: $t",
        $row !== null && ($row['work_type'] ?? null) === null);
}
// Раздел определяет kind, а не источник: смена остаётся сменой и здесь.
check('постоянная со складским названием сохраняет вид работ',
    (ing_normalize(item('Кладовщик') + ['kind' => 'permanent'], 'src')['work_type'] ?? null) === 'stocker');

// ── Профильное проходит ───────────────────────────────────────────────────────
$ours = [
    'Комплектовщик на склад' => 'picker',
    'Сборщик заказов'        => 'picker',
    'Кладовщик'              => 'stocker',
    'Грузчик'                => 'stocker',
    'Повар горячего цеха'    => 'cook',
    'Бригадир смены'         => 'shift_supervisor',
];
foreach ($ours as $title => $expected) {
    $row = ing_normalize(item($title), 'src');
    check("профильное проходит: $title", $row !== null);
    check("вид работ верный: $title", ($row['work_type'] ?? null) === $expected);
}

// ── Названия из ролей, которые запрашивает hh-адаптер ─────────────────────────
// Роль «Повар, пекарь, кондитер» мы просим сами; если «Пекаря» потом не узнать,
// отсев выбросит вакансию, пришедшую по нашему же фильтру.
$roleTitles = [
    'Пекарь'                 => 'cook',
    'Кондитер'               => 'cook',
    'Мойщик посуды'          => 'cook',
    'Упаковщик'              => 'picker',
    'Маркировщик товара'     => 'picker',
    'Приемщик товаров'       => 'stocker',
    'Приёмщик товара'        => 'stocker',
    'Разнорабочий'           => 'stocker',
];
foreach ($roleTitles as $title => $expected) {
    $row = ing_normalize(item($title), 'src');
    check("роль hh распознана: $title", $row !== null && ($row['work_type'] ?? null) === $expected);
}

// ── Готовый work_type от источника важнее догадки по названию ────────────────
// Так работает career-источник и так теперь отдаёт hh-адаптер: профессию уже
// определил тот, кто вакансию опубликовал.
$row = ing_normalize(item('Стажёр в цех', 'cook'), 'src');
check('явный work_type принимается', $row !== null && $row['work_type'] === 'cook');
check('мусорный work_type не принимается на веру',
    ing_normalize(item('Ведущий разработчик Java', 'программист'), 'src') === null);

// ── hh-адаптер: фильтр и разбор ролей ────────────────────────────────────────
$hh = (string)file_get_contents(__DIR__ . '/../php-proxy/headhunter.php');
check('адаптер просит у hh только свои профессии', str_contains($hh, 'professional_role='));
check('роли перечислены отдельными параметрами, а не массивом',
    !str_contains($hh, 'professional_role[]') && str_contains($hh, 'HH_ROLES'));
check('роль раскладывается в вид работ', str_contains($hh, "\$item['work_type'] = \$workType"));
check('догадка по названию оставлена запасным путём',
    str_contains($hh, "professional_roles") && str_contains($hh, "\$workType = ''"));

if ($failures) {
    fwrite(STDERR, "feed relevance: ПРОВАЛЫ\n");
    foreach ($failures as $f) fwrite(STDERR, "  - $f\n");
    exit(1);
}
echo "feed relevance: ok; лента берёт только свои виды работ\n";
