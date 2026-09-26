<?php
// Карточка свайпа: вся вакансия внутри, никуда не уводит, листается вниз.
//
// Раньше эти проверки жили в reply_badge_test.php рядом с плашкой «Отвечает
// в N из M». 25.09 владелец убрал плашку отовсюду — лента становится IT, а
// внешним компаниям мы не пишем, и плашка была у единиц работодателей. Охрана
// карточки при этом нужна по-прежнему, поэтому переехала сюда.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');

// Конец тела ищем по закрытию жеста: тело — обычный View внутри GestureDetector.
$bodyStart = strpos($feed, 'style={styles.cardBody}');
$bodyEnd = $bodyStart !== false ? strpos($feed, '</GestureDetector>', $bodyStart) : false;
$body = ($bodyStart !== false && $bodyEnd !== false)
    ? substr($feed, $bodyStart, $bodyEnd - $bodyStart) : '';
check('тело карточки свайпа найдено', $body !== '');
$descAt = strpos($body, 'Описание вакансии');

// ── Карточка никуда не ведёт ────────────────────────────────────────────────
// Это была жалоба владельца: попытка прокрутить открывала страницу вакансии.
// Причина — кнопка на всей площади карточки: палец, ушедший вниз, отменял
// свайп, список начинал крутить, а нажатие на отпускании срабатывало.
check('тело карточки не кнопка',
    !preg_match('~<(?:Pressable|TouchableOpacity)[^>]*style=\{styles\.cardBody\}~', $feed)
    && str_contains($feed, '<View style={styles.cardBody}>'));
check('из карточки нет перехода на страницу вакансии',
    !str_contains($body, 'perm-vacancy-detail'));
// Вся вакансия должна быть в карточке, иначе уводить всё-таки придётся.
check('в карточке есть расположение', str_contains($body, 'Расположение'));
check('в карточке есть описание', $descAt !== false);
// Описание не ужимается — его листают: карточка растёт по содержимому, а
// список вокруг неё прокручивает.
check('карточка растёт по содержимому, а не режется по экрану',
    str_contains($feed, 'cardAnimated: { flexGrow: 1') && !str_contains($feed, 'cardAnimated: { flex: 1'));
check('описание не режется по числу строк',
    !preg_match('~<Text style=\{pS\.desc\}\s+numberOfLines~', $feed));
check('карточку есть чем листать', str_contains($feed, 'ref={cardScrollRef}'));
// Прокрутка и свайп делят одну площадь, и разнимает их failOffsetY: палец,
// ушедший вниз, отменяет горизонтальный жест.
$deck = (string)file_get_contents(__DIR__ . '/../hooks/useSwipeDeck.ts');
check('вертикаль отменяет свайп', str_contains($deck, '.failOffsetY([-20, 20])'));

// ── Плашки «Отвечает в N из M» нет (решение владельца 25.09) ─────────────────
$perm = (string)file_get_contents(__DIR__ . '/../app/perm-vacancy-detail.tsx');
check('на карточке нет плашки отзывчивости', !str_contains($feed, 'ReplyBadge'));
check('на странице вакансии нет плашки отзывчивости', !str_contains($perm, 'ReplyBadge'));

if ($failures) {
    echo "swipe card: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "swipe card: OK\n";
