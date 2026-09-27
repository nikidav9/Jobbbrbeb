<?php
// Точка на конверте в «Откликах» (решение владельца 28.09.2026): горит, если
// на почте JobToo для откликов есть непрочитанное письмо или непрочитанная
// переписка. Число непрочитанных писем — только своих, без тел писем.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$root = __DIR__ . '/..';
$db = (string)file_get_contents("$root/php-proxy/db.php");
$screen = (string)file_get_contents("$root/app/(tabs)/matches.tsx");

check('только свои письма ($selfArgFns)', str_contains($db, "'jupiterMailUnread' => 0,"));
$at = strpos($db, "case 'jupiterMailUnread':");
$body = $at === false ? '' : substr($db, $at, 500);
check('считаются непрочитанные', str_contains($body, "'read_at' => 'is.null'"));
check('без тел писем — только id', str_contains($body, "], 'id');"));
check('конверт учитывает письма', str_contains($screen, 'unreadChats.length + unreadMail > 0'));
check('число обновляется при возврате на экран', str_contains($screen, 'jupiterMailUnread(currentUserId).then(setUnreadMail)'));
check('чипа «Ответили» нет', !str_contains($screen, "label: 'Ответили'"));

if ($failures) {
    echo "mail unread dot: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "mail unread dot: OK\n";
