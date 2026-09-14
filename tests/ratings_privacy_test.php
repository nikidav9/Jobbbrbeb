<?php
// Анонимность отзывов: экран обещает — сервер обязан сдержать.
//
// На СВОЁМ профиле приложение показывает имя и аватар оценившего. На ЧУЖОМ
// рисует звёзды, роль, дату и текст, без автора. Сервер до этой проверки
// отдавал '*' по любому id — и обещанная анонимность снималась одним запросом:
// смотришь профиль работодателя, видишь «⭐2, Работник, 03.09», и узнаёшь, кто
// именно это написал.
//
// Проверка текстовая, потому что живой базы отсюда нет. Значит каждое
// утверждение здесь должно ловить поломку кода — иначе оно создаёт видимость.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}': {");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$h = case_body($db, 'dbGetRatingsForUser');
check('обработчик найден', $h !== '');

// ── Колонки зависят от того, о ком спрашивают ────────────────────────────────
check('свой ли профиль — решает подписанная сессия',
    str_contains($h, '$mine = $authUid !== null && $authUid !== \'\' && $who === $authUid;'));
check('о себе — всё', str_contains($h, "\$cols = \$mine ? '*' :"));
check('о чужом — узкий список',
    str_contains($h, "'id,rating,role,review_text,created_at'"));
// ГЛАВНОЕ: ни одного поля, по которому вычисляется автор.
foreach (['from_user_id', 'like_id', 'vacancy_id'] as $col) {
    check("{$col} не уходит на чужой профиль",
        !preg_match("~'id,rating,role,review_text,created_at[^']*{$col}~", $h));
}
// Звёздочка не должна остаться единственным вариантом.
check('всем подряд звёздочка не отдаётся',
    !str_contains($h, "], '*', 'created_at.desc')"));
// Подставляется проверенный $who, а не сырой довод: иначе в фильтр уедет что
// угодно из запроса.
check('фильтр по проверенному доводу',
    str_contains($h, "['to_user_id' => 'eq.' . \$who]")
    && !str_contains($h, "['to_user_id' => 'eq.' . \$args[0]]"));

// ── Экраны и правда такие ────────────────────────────────────────────────────
// Урок 13.09: не описывать интерфейс по именам файлов — сверять с кодом.
$own = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
check('на своём профиле имя оценившего показывается',
    str_contains($own, 'const reviewer = users.find(u => u.id === item.fromUserId);'));
$other = (string)file_get_contents(__DIR__ . '/../app/user-profile.tsx');
check('на чужом профиле автор не рисуется', !str_contains($other, 'fromUserId'));
// Если чужой экран однажды захочет автора — эта проверка покраснеет, и решение
// придётся принимать заново, а не молча расширять выдачу.

// ── Тип не врёт про то, что придёт ───────────────────────────────────────────
$ts = (string)file_get_contents(__DIR__ . '/../services/db.ts');
check('поля автора необязательные',
    str_contains($ts, 'fromUserId?: string;') && str_contains($ts, 'vacancyId?: string;'));

if ($failures) {
    echo "ratings privacy: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "ratings privacy: OK\n";
