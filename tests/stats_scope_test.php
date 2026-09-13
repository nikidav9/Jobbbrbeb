<?php
// Счётчики по вакансиям — только по своим.
//
// Задача 22. Не дыра в том смысле, что персональных данных в карте нет: она
// отдаёт числа откликов, отказов и просмотров по идентификаторам вакансий.
// Но числа эти — чужие: сколько откликов у соседней лавки, знать незачем. И
// читались для этого две таблицы целиком, на каждое обновление экрана.
//
// Карту читает ровно один экран — «мои вакансии», и он и так фильтрует список
// по себе. Значит сузить выборку на сервере ничего не стоит.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function fn_body(string $src, string $name): string
{
    $start = strpos($src, "function {$name}(");
    if ($start === false) return '';
    $end = strpos($src, "\n}\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

// ── Свои вакансии ────────────────────────────────────────────────────────────
$own = fn_body($db, 'jt_own_vacancy_ids');
check('список своих вакансий есть', $own !== '');
check('выбирается по сессии', str_contains($own, "['employer_id' => 'eq.' . \$me]"));
check('без сессии список пуст', str_contains($own, "if (\$me === '') return [];"));

// Идентификаторы уходят в адрес запроса — порции обязательны, иначе
// работодатель с сотней вакансий упрётся в его длину.
$rows = fn_body($db, 'jt_rows_for_vacancies');
check('выборка идёт порциями', str_contains($rows, 'array_chunk($vacancyIds, 100)'));
// Значения в фильтре берём в кавычки: id вакансии приходит из базы, но правило
// одно на все списки — см. sb_in_list.
check('значения экранируются', str_contains($rows, "sb_in_list(\$chunk)"));

// ── Обе карты сужены ─────────────────────────────────────────────────────────
foreach (['dbGetVacancyStatsMap' => 'jm_vacancies',
          'dbGetPermVacancyViewsMap' => 'jm_perm_vacancies'] as $op => $table) {
    $body = case_body($db, $op);
    check("{$op}: тело найдено", $body !== '');
    check("{$op}: берёт свои вакансии", str_contains($body, "jt_own_vacancy_ids('{$table}', \$authUid)"));
    check("{$op}: без своих вакансий — пустая карта", str_contains($body, 'if (!$mine) { $data = new stdClass(); break; }'));
    // Таблицы целиком больше не читаются.
    check("{$op}: таблица целиком не выбирается",
        !preg_match("~sb_select_all\('jm_\w+', \[\],~", $body));
}

// ── Экран и так показывает только свои ───────────────────────────────────────
// Если бы это было не так, сужение на сервере сломало бы экран.
check('экран фильтрует вакансии по себе',
    str_contains($feed, 'const myVacancies = vacancies.filter(v => v.employerId === currentUser?.id);')
    && str_contains($feed, 'const myPermVacancies = permVacancies.filter(v => v.employerId === currentUser?.id);'));

if ($failures) {
    echo "stats scope: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "stats scope: OK\n";
