<?php
// Уровень, формат и специализация вакансии — паритет с services/vacancyFacets.ts
// проверяется общим файлом случаев (tests/vacancy-facets.test.ts читает его же).

require __DIR__ . '/../php-proxy/vacancy_facets.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$cases = json_decode(file_get_contents(__DIR__ . '/fixtures/vacancy_facets_cases.json'), true);
check('файл случаев прочитан и их не меньше 40', is_array($cases) && count($cases) >= 40);

foreach ($cases as $i => $c) {
    $title = (string)($c['title'] ?? '');
    $level = vf_level($title);
    $format = vf_format($c['schedule'] ?? null, $c['text'] ?? null);
    $specs = vf_specs($title);
    check("уровень #$i «{$title}»", $level === $c['level']);
    check("формат #$i «{$title}»", $format === $c['format']);
    check("специализация #$i «{$title}»", $specs === $c['specs']);
}

// Несколько прицельных проверок сверх таблицы — те же примеры, что в
// комментарии к SPEC_RULES в vacancyFacets.ts.
check('QA раньше бэкенда', vf_specs('Java QA Automation') === ['qa']);
check('мобильная раньше бэкенда', vf_specs('Android-разработчик (Kotlin)') === ['mobile']);
check('аналитика, а не data', vf_specs('Аналитик данных') === ['analytics']);
check('data, а не бэкенд', vf_specs('Data Engineer (Python)') === ['data']);
check('fullstack — фронтенд и бэкенд разом', vf_specs('Fullstack-разработчик (JS/React)') === ['frontend', 'backend']);
check('неизвестное название — пустой список', vf_specs('Разработчик программного обеспечения') === []);
check('пустое название — пустой список', vf_specs('') === []);

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "vacancy facets: ok\n";
