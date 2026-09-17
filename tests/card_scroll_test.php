<?php
// Карточка вакансии листается вниз, а свайп вбок при этом жив.
//
// Проводка здесь хрупкая и рвётся молча: typecheck на неё слеп, а на снимках
// экрана в браузере ничего не видно — колесо мыши прокручивает и то, что
// пальцем не прокручивается. Поймали это только настоящим касанием, поэтому
// условия записаны сюда.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$deck = (string)file_get_contents(__DIR__ . '/../hooks/useSwipeDeck.ts');

// ── Список вокруг карточки — из gesture-handler, а не из react-native ───────
// Обычный ScrollView живёт вне разбора жестов: Pan забирает касание первым, и
// failOffsetY не успевает его отпустить — карточка просто не листается.
check('колода обёрнута списком gesture-handler',
    str_contains($feed, 'ScrollView as GHScrollView') && str_contains($feed, '<GHScrollView'));
check('потягивание для обновления тоже из gesture-handler',
    str_contains($feed, 'RefreshControl as GHRefreshControl') &&
    str_contains($feed, '<GHRefreshControl'));
// Внутри колоды не должно остаться обычного ScrollView: он вернёт ту же беду.
$deckStart = strpos($feed, '<GHScrollView');
$deckEnd = strpos($feed, '</GHScrollView>');
$deckMarkup = ($deckStart !== false && $deckEnd !== false)
    ? substr($feed, $deckStart, $deckEnd - $deckStart) : '';
check('разметка колоды найдена', $deckMarkup !== '');
check('внутри колоды нет второго списка', !str_contains($deckMarkup, '<ScrollView'));

// ── Жест отпускает вертикаль ────────────────────────────────────────────────
check('жест проигрывает при движении вниз', str_contains($deck, 'failOffsetY('));
// На вебе одного failOffsetY мало: gesture-handler ставит области жеста
// touch-action: none, и браузер перестаёт прокручивать её пальцем вообще.
check('вертикаль отдана браузеру', str_contains($deck, "touchAction = 'pan-y'"));
// Горизонталь остаётся нашей — иначе свайпа не будет.
check('горизонталь не отдана', !preg_match("~touchAction = '(auto|pan-x pan-y|manipulation)'~", $deck));
check('свайп вбок по-прежнему включается раньше', str_contains($deck, 'activeOffsetX('));

if ($failures) {
    echo "card scroll: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "card scroll: OK\n";
