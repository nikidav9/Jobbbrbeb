<?php
// Кому можно написать и чьё можно трогать.
//
// Написано по сплошной ревизии прав в db.php — той самой, ради которой ревизия
// и затевалась. Четыре дыры, найденные раньше, нашлись по следам жалобы; эти
// восемь — списком, и они хуже.
//
// Операции требовали входа, и только. Кому именно пишем — не проверялось:
// любой зарегистрировавшийся мог отправить через НАШЕГО бота произвольный
// текст любому человеку сервиса по id, положить ему в колокольчик что угодно,
// взять чужой пуш-токен и слать на него напрямую (токен Expo сам по себе
// никого не спрашивает). Для сервиса, где ищут работу, это готовая рассылка
// от имени JobToo.
//
// Правило: писать можно тому, с кем уже есть связь — переписка, отклик на
// смену или заявка на постоянную вакансию. Рассылка по базе закрыта.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

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

// ── Уведомления человеку шлёт только сервер ──────────────────────────────────
// Правило «кому вправе написать» (jt_may_notify) отсюда УБРАНО, и это не
// ослабление, а следующий шаг. Оно стерегло операции, которыми пользовался
// клиент; теперь клиент их не зовёт вовсе — уведомление отправляет сервер там
// же, где записывает событие. Сторож, которого никто не зовёт, создаёт
// видимость проверки, поэтому вместо него операции закрыты админским токеном.
check('правило связи убрано вместе с нуждой в нём',
    !str_contains($db, 'function jt_may_notify') && !str_contains($db, 'jt_require_notify_right'));

$adminBlock = '';
if (preg_match('~\$adminFns = \[(.*?)\n\];~s', $db, $m)) $adminBlock = $m[1];
check('список админских операций найден', $adminBlock !== '');
foreach (['tgNotifyUser', 'sendPushNotification', 'tgNotifyNewApplication',
          'dbGetPushToken', 'dbSaveNotification'] as $op) {
    check("{$op} — только админским токеном", str_contains($adminBlock, "'{$op}'"));
}
// Приложение не должно уметь их звать: иначе смысла в переносе нет.
$clientFiles = ['services/db.ts', 'services/notifications.ts'];
foreach ($clientFiles as $rel) {
    $src = (string)file_get_contents(__DIR__ . '/../' . $rel);
    foreach (['tgNotifyUser', 'sendPushNotification', 'dbGetPushToken', 'dbSaveNotification'] as $op) {
        check("{$rel} не зовёт {$op}", !str_contains($src, "'{$op}'"));
    }
}

// ── Своё и только своё ────────────────────────────────────────────────────────
// Прежде брали id записи и не смотрели, чья она.
$release = case_body($db, 'dbReleasePushToken');
check('токен отвязывает только его владелец',
    str_contains($release, "\$uid = (string)(\$authUid ?? '')")
    && str_contains($release, "'id' => 'eq.' . \$uid"));
foreach (['dbMarkNotifRead', 'dbDeleteNotif'] as $op) {
    $body = case_body($db, $op);
    check("{$op}: только своё уведомление",
        str_contains($body, "'user_id' => 'eq.' . (string)(\$authUid ?? '')"));
}

// Удаление отклика стирает вместе с ним итог смены и основание рейтинга.
$delMatch = case_body($db, 'dbDeleteMatch');
check('отклик удаляет только его сторона',
    str_contains($delMatch, "jt_shift_party((string)(\$args[0] ?? ''), \$authUid, false);"));
$partyAt = strpos($delMatch, 'jt_shift_party');
$delAt = strpos($delMatch, "sb_delete('jm_likes'");
check('проверка стороны раньше удаления',
    $partyAt !== false && $delAt !== false && $partyAt < $delAt);

// ── Что вообще не для пользователя ───────────────────────────────────────────
// Разовая уборка по ВСЕМ чатам сервиса.
$adminBlock = '';
if (preg_match('~\$adminFns = \[(.*?)\n\];~s', $db, $m)) $adminBlock = $m[1];
check('список админских операций найден', $adminBlock !== '');
check('слияние чатов — админская', str_contains($adminBlock, "'dbMergeDuplicateChats'"));

if ($failures) {
    echo "notify authz: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "notify authz: OK\n";
