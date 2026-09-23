<?php
// Свайп-удаление переписки: проводка жеста.
//
// Правило фронтенда этого проекта: жесты только через gesture-handler, не
// PanResponder. Оно оплачено ошибкой — PanResponder умеет «беру жест», но не
// умеет «я ошибся, забирайте», и карточка в ленте улетала от попытки
// прокрутки. В chats.tsx свайп жил на PanResponder до 23.09: жест работал, и
// именно поэтому его не трогали, а правило он нарушал.
//
// Проверяем не текст, а проводку. Она рвётся молча: typecheck к ней слеп, на
// снимках экрана не видна, а колесо мыши прокручивает и то, что пальцем не
// прокручивается.

$fails = [];
function check(string $name, bool $ok): void
{
    global $fails;
    if (!$ok) $fails[] = $name;
}

$chats = (string)file_get_contents(__DIR__ . '/../app/(tabs)/chats.tsx');

// ── Жест ────────────────────────────────────────────────────────────────
check('PanResponder больше не используется',
    !preg_match('~PanResponder\.create|panHandlers~', $chats));
check('жест собран через gesture-handler', str_contains($chats, 'Gesture.Pan()'));
check('строка обёрнута в GestureDetector', str_contains($chats, '<GestureDetector gesture={gesture}>'));

// Вход вбок раньше отмены вниз: иначе диагональ читается как открытие кнопки,
// а не как прокрутка списка.
check('горизонталь включается порогом', str_contains($chats, '.activeOffsetX([-10, 10])'));
check('вертикаль отменяет жест', str_contains($chats, '.failOffsetY('));

// ── Список вокруг строки ────────────────────────────────────────────────
// Обычный FlatList лежит вне разбора жестов: отпустить касание, когда палец
// пошёл вниз, там некому.
check('список из gesture-handler',
    str_contains($chats, 'FlatList as GHFlatList') && str_contains($chats, '<GHFlatList'));
check('потягивание для обновления тоже из gesture-handler',
    str_contains($chats, 'RefreshControl as GHRefreshControl') && str_contains($chats, '<GHRefreshControl'));
check('обычный список не остался',
    !preg_match('~<FlatList[\s>]|<RefreshControl[\s>]~', $chats));

// ── Веб ─────────────────────────────────────────────────────────────────
// gesture-handler ставит на область touch-action: none, и страница перестаёт
// листаться пальцем ВООБЩЕ — даже после того, как failOffsetY отменил жест.
check('вертикаль отдана браузеру', str_contains($chats, "touchAction = 'pan-y'"));
check('горизонталь не отдана',
    !preg_match("~touchAction = '(auto|pan-x pan-y|manipulation)'~", $chats));
// После перетаскивания браузер присылает click, и строка открывалась следом
// за свайпом.
check('нажатие сразу после свайпа пропускается',
    str_contains($chats, 'if (!wasSwipe()) onPress();'));

// ── Анимация ────────────────────────────────────────────────────────────
// Animated с useNativeDriver: false гонит каждый кадр через мост JS.
check('движение считается на потоке интерфейса',
    str_contains($chats, 'useAnimatedStyle') && str_contains($chats, '<Reanimated.View'));
check('моста больше нет', !str_contains($chats, 'useNativeDriver'));

// ── Ширина кнопки и ход строки — одно число ─────────────────────────────
// Раньше -120 стояло в жесте, а ширина кнопки в стилях: совпадали на честном
// слове.
check('ход строки равен ширине кнопки',
    preg_match('~const ACTION_WIDTH = ~', $chats)
    && str_contains($chats, 'width: ACTION_WIDTH,')
    && !preg_match('~toValue: -120|Math\.max\(-120~', $chats));

if ($fails) {
    echo "chats swipe: ПРОВАЛЫ\n";
    foreach ($fails as $f) echo "  - $f\n";
    exit(1);
}
echo "chats swipe: OK\n";
