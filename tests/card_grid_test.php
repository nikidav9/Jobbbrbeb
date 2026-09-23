<?php
// Сетка карточки вакансии.
//
// Зачем сторож. Отступы карточки расползались молча: typecheck к числам слеп,
// а на глаз разница между 13 и 16 не видна, пока не поставишь блоки рядом. Так
// и вышло — плашка отзывчивости была отбита от краёв на 8, когда всё остальное
// на 21, и торчала шире чипов над собой; между секциями складывались два
// отступа подряд, 13 + 13, при 8 внутри секции. Три разных шага вместо одного.
//
// Правило простое: все отступы карточки берутся из ряда Фибоначчи
// 5 / 8 / 13 / 21 / 34. Соседние числа отличаются заметно, поэтому вложенность
// читается без разделителей: 8 внутри секции, 13 внутри верхнего блока, 21 —
// поля карточки и промежуток между секциями.

$feed = file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$fails = [];

function check(string $name, bool $ok): void
{
    global $fails;
    if (!$ok) $fails[] = $name;
}

/**
 * Строка описания стиля по имени — в нужном наборе, а не в первом попавшемся.
 *
 * В feed.tsx несколько StyleSheet.create, и имена в них повторяются: cardTop
 * есть и у карточки колоды, и у строки списка откликов. Без этого сторож
 * проверял чужой стиль и требовал от него чужую сетку.
 */
function style(string $feed, string $sheet, string $name): string
{
    $start = strpos($feed, 'const ' . $sheet . ' = StyleSheet.create({');
    if ($start === false) return '';
    $rest = substr($feed, $start);
    return preg_match('~^\s*' . preg_quote($name, '~') . ':\s*\{[^\n]*~m', $rest, $m) ? $m[0] : '';
}

const GRID = [5, 8, 13, 21, 34];

// Стили самой колоды. Вложенные блоки (locRow, mapBtn) сюда же: они внутри
// карточки, и их отступы человек видит рядом с остальными.
$styles = [
    'styles' => ['cardTop', 'cardMiddle', 'replyBadgeWrap', 'cardDivider', 'chipsRow'],
    'pS'     => ['sectionBlock', 'blockHead', 'locRow', 'mapBtn'],
];

foreach ($styles as $sheet => $names) foreach ($names as $name) {
    $line = style($feed, $sheet, $name);
    check("стиль $name найден", $line !== '');
    if ($line === '') continue;
    // rs(N) — единственный способ задать отступ; голые числа здесь не ищем,
    // потому что height: 1 у разделителя к сетке отношения не имеет.
    preg_match_all('~rs\(([0-9.]+)\)~', $line, $m);
    foreach ($m[1] as $raw) {
        check("$name: отступ $raw из ряда Фибоначчи", in_array((int)$raw, GRID, true) && (float)$raw == (int)$raw);
    }
}

// Поля карточки равны со всех сторон. Раньше низ верхнего блока был 13 против
// 21 по бокам — и заголовок стоял ближе к чипам, чем к краю.
check('поля верхнего блока равны со всех сторон',
      preg_match('~cardTop:\s*\{\s*padding:\s*rs\(21\),~', $feed) === 1
      && !preg_match('~cardTop:\s*\{[^}]*paddingBottom~', $feed));
check('поля средней части равны со всех сторон',
      preg_match('~cardMiddle:\s*\{[^}]*padding:\s*rs\(21\)~', $feed) === 1
      && !preg_match('~cardMiddle:\s*\{[^}]*paddingVertical~', $feed));

// Плашка отзывчивости стоит по тем же краям, что и разделитель под ней.
check('плашка отзывчивости выровнена по разделителю',
      preg_match('~replyBadgeWrap:\s*\{[^}]*marginHorizontal:\s*rs\(21\)~', $feed) === 1
      && preg_match('~cardDivider:\s*\{[^}]*marginHorizontal:\s*rs\(21\)~', $feed) === 1);

// Промежуток между секциями задаётся в одном месте — контейнером. marginBottom
// у секции складывался с ним, и выходило 26 там, где задумано 21.
check('промежуток между секциями задаёт только контейнер',
      !preg_match('~sectionBlock:\s*\{[^}]*margin~', $feed));

if ($fails) {
    echo "сетка карточки: ПРОВАЛЫ\n";
    foreach ($fails as $f) echo "  - $f\n";
    exit(1);
}
echo "сетка карточки: OK\n";
