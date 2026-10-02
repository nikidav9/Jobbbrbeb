<?php
// Дневной запас откликов (молнии) доходит до экрана.
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

// ── Молнию тратит только отклик (решение владельца 26.09) ──────────────────
// Раньше списывали оба направления. Теперь пропуск бесплатный: молния — цена
// отклика, а не просмотра. Листать ленту можно и с пустым запасом.
$want = arrow_body($feed, 'swWant');
check('swWant найдена', $want !== '');
check('отклик списывает запас', str_contains($want, 'energy.spendOne()'));
check('отклик при пустом запасе показывает плашку', str_contains($want, 'setLimitOpen(true)'));
// Жест уже увёл карточку вбок. Без возврата на место она останется висеть
// за краем, и человек решит, что приложение зависло.
check('отклик возвращает карточку на место',
    (bool)preg_match('~setLimitOpen\(true\); swDeck\.snapBack\(\);~', $want));
// Списание идёт ДО улёта, а не в колбэке: иначе при исчерпанном запасе
// карточка успеет улететь, и вакансия потеряется без списания.
$spendAt = strpos($want, 'energy.spendOne()');
$flyAt = strpos($want, 'swFly(');
check('отклик списывает до улёта карточки', $spendAt !== false && $flyAt !== false && $spendAt < $flyAt);

$skip = arrow_body($feed, 'swSkip');
check('swSkip найдена', $skip !== '');
check('пропуск молнию не тратит', !str_contains($skip, 'energy.'));
check('пропуск не упирается в плашку запаса', !str_contains($skip, 'setLimitOpen'));

// Гость упирается в стену регистрации — и его карточка должна вернуться на
// место, а не повиснуть. Это был старый недосмотр.
check('гостю после стены регистрации карточка возвращается',
    (bool)preg_match('~promptRegister\(\{ vacancyKind: \'permanent\' \}\);\s*\n\s*swDeck\.snapBack\(\);~', $skip));

// ── «Вернуть» — одна пропущенная карточка, без молнии ──────────────────────
// Отклик не возвращается: он уже ушёл. Иначе была бы лазейка «откликнулся —
// вернул — получил молнию обратно», и дневной запас ничего бы не значил.
$undo = strpos($feed, 'const swUndo = useCallback');
$undoEnd = $undo !== false ? strpos($feed, "\n  }, [swLastSkipped", $undo) : false;
$undoBody = ($undo !== false && $undoEnd !== false) ? substr($feed, $undo, $undoEnd - $undo) : '';
check('возврат вакансии найден', $undoBody !== '');
check('возврат молнию не отдаёт', !str_contains($undoBody, 'energy.'));
check('возврат забывает карточку — второй раз назад не шагнуть',
    str_contains($undoBody, 'setSwLastSkipped(null)'));
check('истории из нескольких карточек нет', !str_contains($feed, 'swHistory'));
check('пропуск запоминает карточку для возврата', str_contains($skip, 'setSwLastSkipped(c.v.id)'));
check('отклик возврат гасит', substr_count($want, 'setSwLastSkipped(null)') >= 3);
check('кнопка есть, только когда есть что вернуть',
    str_contains($feed, 'onUndo={swLastSkipped ? swUndo : null}'));

// ── Отклик не замораживает колоду (27.09) ───────────────────────────────────
// Раньше свайп вправо ждал резюме, почту, поручение и саму заявку подряд —
// четыре запроса, и всё это время следующую карточку нельзя было тронуть.
// Заявка теперь уходит в фоне, а проверки помнят успех.
check('заявка Юпитеру не держит колоду',
    str_contains($want, 'void sendExtApply(') && !str_contains($want, 'await sendExtApply'));
$prepAt = strpos($want, 'prepareExtApply()');
$sendAt = strpos($want, 'sendExtApply(');
$nextAt = $prepAt !== false ? strpos($want, 'setSwSkipped', $prepAt) : false;
check('следующая карточка открывается до отправки заявки',
    $nextAt !== false && $sendAt !== false && $nextAt < $sendAt);
check('не дошла заявка — молния назад', (bool)preg_match('~sendExtApply\(ev\)[\s\S]{0,300}energy\.refundOne\(\)~', $want));
$gate = (string)file_get_contents(__DIR__ . '/../services/resumeGate.ts');
$live = (string)file_get_contents(__DIR__ . '/../services/jupiterLive.ts');
check('проверка резюме помнит успех', str_contains($gate, 'resumeOkUntil') && str_contains($gate, 'export function forgetResumeCheck'));
check('поручение Юпитеру помнит успех', str_contains($live, 'liveOk') && str_contains($live, 'export function forgetJupiterLive'));
$profile = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
$settings = (string)file_get_contents(__DIR__ . '/../app/profile-settings.tsx');
check('смена резюме сбрасывает память', substr_count($profile, 'forgetResumeCheck()') >= 2);
// Переключателя автоотклика нет с 28.09.2026: отклик отправляет человек.
check('переключателя автоотклика в настройках нет', !str_contains($settings, 'Автоотклик Юпитера'));

// ── Счётчик в шапке показывает запас, а не что-нибудь ещё ───────────────────
// Раньше там было число вакансий в подборке. Если проводку перепутать
// обратно, экран останется красивым и будет врать.
check('шапка получает запас', str_contains($feed, 'energy={energy.left}'));
check('счётчик подписан как отклики, а не как вакансии',
    str_contains($feed, 'Откликов осталось на сегодня') &&
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

// Молнии кончились — лента закрыта до полуночи (решение владельца 02.10.2026).
check('лента закрывается при пустом запасе',
    (bool)preg_match('~feedLocked = energy\.ready && energy\.left <= 0~', $feed));
check('закрытая лента рисуется вместо колоды, до пустого состояния',
    (bool)preg_match('~\{feedLocked \? \([\s\S]{0,1500}\) : !swTop \?~', $feed));
check('гостей не закрываем', str_contains($feed, '!currentUser.isGuest;'));
check('плашка не обещает листание без молний', !str_contains($feed, 'Листать и пропускать вакансии можно'));

if ($failures) {
    echo "swipe energy: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "swipe energy: OK\n";
