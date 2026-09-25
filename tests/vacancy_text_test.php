<?php
// Полное описание вакансии со страницы: разбор на реальных карьерных страницах
// плюс юнит-тесты на самих кирпичиках (vt_html_to_text, vt_markdown_normalize).

require __DIR__ . '/../php-proxy/vacancy_text.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function fixture(string $name): string
{
    return file_get_contents(__DIR__ . "/fixtures/vacancy_pages/$name.html");
}

// ── Юнит: vt_html_to_text ─────────────────────────────────────────────────

check(
    'короткий <p><strong>…:</strong></p> становится заголовком без двоеточия',
    str_contains(vt_html_to_text('<p><strong>Кого мы ищем:</strong></p><p>Текст.</p>'), "## Кого мы ищем\n")
);
check('<li> становится пунктом с точкой', str_starts_with(vt_html_to_text('<ul><li>Первый пункт</li></ul>'), '• Первый пункт'));
check('&nbsp; превращается в обычный пробел', vt_html_to_text('<p>Слово&nbsp;слово</p>') === 'Слово слово');
check('<br> — перенос строки внутри абзаца, без пустой строки', vt_html_to_text('<p>Строка раз<br>Строка два</p>') === "Строка раз\nСтрока два");
check('<h2> становится заголовком', str_contains(vt_html_to_text('<h2>Обязанности:</h2><p>Текст</p>'), "## Обязанности\n"));
check('соседние абзацы разделены пустой строкой', vt_html_to_text('<p>Раз</p><p>Два</p>') === "Раз\n\nДва");
check('лишние пробелы исходника схлопываются', vt_html_to_text("<p>Слово   \n  слово</p>") === 'Слово слово');
check('обычные теги пропадают без следа', !str_contains(vt_html_to_text('<p><a href="#">Ссылка</a> текст</p>'), '<'));

// ── Юнит: vt_markdown_normalize ───────────────────────────────────────────

check(
    '«### **Текст:**» становится «## Текст»',
    vt_markdown_normalize("### **Что нужно делать:**\n\n*   пункт") === "## Что нужно делать\n\n• пункт"
);
check('маркер "-" тоже превращается в точку', str_starts_with(vt_markdown_normalize("- пункт списка"), '• пункт списка'));
check('одиночная звёздочка-маркер списка тоже превращается в точку', str_starts_with(vt_markdown_normalize("* пункт списка"), '• пункт списка'));
check('жирность вне заголовков снимается', vt_markdown_normalize('Обычный **жирный** текст') === 'Обычный жирный текст');
check('результат не содержит "**"', !str_contains(vt_markdown_normalize("### **Заголовок**\n\n**важно**"), '**'));

// ── Образцы реальных страниц ───────────────────────────────────────────────

$sber = vt_extract(fixture('sber'));
check('Сбер: описание длинное', mb_strlen($sber) >= 300);
check('Сбер: есть раздел обязанностей', str_contains($sber, '## Что нужно делать'));
check('Сбер: есть раздел требований', str_contains($sber, '## Мы ждем, что ты'));
check('Сбер: есть раздел условий', str_contains($sber, '## Что мы предлагаем'));
check('Сбер: есть пункты списка', str_contains($sber, '• '));
check('Сбер: тегов не осталось', !preg_match('~<[a-z/][^>]*>~i', $sber));
check('Сбер: markdown-жирности не осталось', !str_contains($sber, '**'));

$magnit = vt_extract(fixture('magnit'));
check('Магнит: описание длинное', mb_strlen($magnit) >= 300);
check('Магнит: есть пункты списка', str_contains($magnit, '• '));
check('Магнит: тегов не осталось', !preg_match('~<[a-z/][^>]*>~i', $magnit));

$metro = vt_extract(fixture('metro'));
check('METRO: описание длинное', mb_strlen($metro) >= 300);
check('METRO: есть раздел обязанностей', str_contains($metro, '## Обязанности'));
check('METRO: есть раздел условий', str_contains($metro, '## Условия'));
check('METRO: есть пункты (абзацы) описания', str_contains($metro, 'Работа на кассе'));
check('METRO: нет рекламной фразы из meta description', !str_contains($metro, 'Все вакансии сети магазинов'));
check('METRO: тегов не осталось', !preg_match('~<[a-z/][^>]*>~i', $metro));

$perflab = vt_extract(fixture('perflab'));
check('Performance Lab: описание длинное', mb_strlen($perflab) >= 300);
check('Performance Lab: есть раздел обязанностей', str_contains($perflab, '## Обязанности'));
check('Performance Lab: есть раздел требований', str_contains($perflab, '## Требования'));
check('Performance Lab: есть раздел условий', str_contains($perflab, '## Условия'));
check('Performance Lab: есть пункты списка', str_contains($perflab, '• '));
check('Performance Lab: нет текста меню сайта', !str_contains($perflab, 'Главная Вакансии Контакты'));
check('Performance Lab: нет текста подвала сайта', !str_contains($perflab, 'Перфоманс Лаб'));
check('Performance Lab: нет формы отклика', !str_contains($perflab, 'Откликнуться на вакансию'));
check('Performance Lab: тегов не осталось', !preg_match('~<[a-z/][^>]*>~i', $perflab));

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "vacancy text: ok\n";
