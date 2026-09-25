<?php
// Дневной запас свайпов доходит до экрана.
//
// Чистая логика запаса проверена отдельно (tests/energy.test.ts): там и
// «не копится», и границы. Здесь другое — что эту логику вообще позвали.
// Проводку рвёт тише всего: списание останется в одном направлении из двух,
// или плашка появится, а карточка так и повиснет сбоку, и тесты на чистых
// функциях этого не увидят, потому что функции-то целы.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');

/** Тело функции-стрелки `const <имя> = (...) => {` до её `\n  };`. */
function arrow_body(string $src, string $name): string
{
    $start = strpos($src, 'const ' . $name . ' = ');
    if ($start === false) return '';
    $end = strpos($src, "\n  };\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : '';
}

// ── Списывают ОБА направления ────────────────────────────────────────────────
// Свайп влево не бесплатный: отказ — такое же решение, как и отклик, и ровно
// им человек чаще всего и пользуется.
foreach (['swWant' => 'вправо', 'swSkip' => 'влево'] as $fn => $dir) {
    $body = arrow_body($feed, $fn);
    check("$fn найдена", $body !== '');
    check("свайп $dir списывает запас", str_contains($body, 'energy.spendOne()'));
    check("свайп $dir при пустом запасе показывает плашку",
        str_contains($body, 'setLimitOpen(true)'));
    // Жест уже увёл карточку вбок. Без возврата на место она останется висеть
    // за краем, и человек решит, что приложение зависло.
    check("свайп $dir возвращает карточку на место",
        (bool)preg_match('~setLimitOpen\(true\); swDeck\.snapBack\(\);~', $body));
    // Списание идёт ДО улёта, а не в колбэке: иначе при исчерпанном запасе
    // карточка успеет улететь, и вакансия потеряется без списания.
    $spendAt = strpos($body, 'energy.spendOne()');
    $flyAt = strpos($body, 'swFly(');
    check("свайп $dir списывает до улёта карточки",
        $spendAt !== false && $flyAt !== false && $spendAt < $flyAt);
}

// Гость упирается в стену регистрации раньше запаса — и его карточка тоже
// должна вернуться на место, а не повиснуть. Это был старый недосмотр.
$skip = arrow_body($feed, 'swSkip');
check('гостю после стены регистрации карточка возвращается',
    (bool)preg_match('~promptRegister\(\{ vacancyKind: \'permanent\' \}\);\s*\n\s*swDeck\.snapBack\(\);~', $skip));

// ── Возврат вакансии возвращает и списанный свайп ───────────────────────────
// Иначе промах наказан дважды: и карточку верни, и энергию потерял.
$undo = strpos($feed, 'const swUndo = useCallback');
// Конец — список зависимостей, начинающийся с energy: в нём может быть и
// ещё что-то (с 25.09 — currentUser?.id, чтобы снять свайп на сервере).
$undoEnd = $undo !== false ? strpos($feed, "\n  }, [energy", $undo) : false;
$undoBody = ($undo !== false && $undoEnd !== false) ? substr($feed, $undo, $undoEnd - $undo) : '';
check('возврат вакансии найден', $undoBody !== '');
check('возврат вакансии возвращает свайп', str_contains($undoBody, 'energy.refundOne()'));

// ── Счётчик в шапке показывает запас, а не что-нибудь ещё ───────────────────
// Раньше там было число вакансий в подборке. Если проводку перепутать
// обратно, экран останется красивым и будет врать.
check('шапка получает запас', str_contains($feed, 'energy={energy.left}'));
check('счётчик подписан как свайпы, а не как вакансии',
    str_contains($feed, 'Свайпов осталось на сегодня') &&
    !str_contains($feed, 'Вакансий в подборке'));
check('по счётчику можно открыть объяснение', str_contains($feed, 'onEnergyPress'));

// ── Плашка говорит правду ───────────────────────────────────────────────────
// Число в тексте берётся из константы, а не вписано руками: разойдутся —
// и приложение начнёт обещать не тот запас, который выдаёт.
check('плашка берёт размер запаса из константы', str_contains($feed, '{DAILY_ENERGY}'));
check('плашка объясняет, что запас не копится',
    str_contains($feed, 'запас не копится'));
// Покупки нет — и обещать её нельзя.
check('плашка не обещает несуществующую покупку',
    !preg_match('~(Купить|Пополнить|Оформить подписк)~u', $feed));

if ($failures) {
    echo "swipe energy: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "swipe energy: OK\n";
