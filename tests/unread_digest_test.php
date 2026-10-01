<?php
// Письмо-сводка о непрочитанном (решение владельца 01.10.2026): раз в день,
// без содержания, только тем, у кого нет другого канала.
$fails = [];
function check(string $name, bool $ok): void { global $fails; if (!$ok) $fails[] = $name; }
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

preg_match('~const JT_DIGEST_MAX = \d+;~', $db, $c);
preg_match('~function jt_unread_digest_mail\(int \$n\): array \{.*?\n\}\n~s', $db, $f1);
preg_match('~function jt_unread_digest\(\): array \{.*?\n\}\n~s', $db, $f2);
check('функции сводки есть', $c && $f1 && $f2);

$NOTES = []; $USERS = []; $WEB = []; $CONSENT = []; $MAIL = []; $MAILFAIL = false;
function sb_select_all($t, $f = [], $s = '*') { global $NOTES; return $NOTES; }
function sb_in_list(array $v) { return 'in.(' . implode(',', $v) . ')'; }
function sb_select($t, $f = [], $s = '*') {
    global $USERS, $WEB;
    $ids = explode(',', trim(substr($f[$t === 'jm_users' ? 'id' : 'user_id'], 3), '()'));
    if ($t === 'jm_users') return array_values(array_filter($USERS, fn($u) => in_array($u['id'], $ids, true)));
    return array_values(array_filter($WEB, fn($w) => in_array($w['user_id'], $ids, true)));
}
function jt_has_crossborder_consent($uid) { global $CONSENT; return !empty($CONSENT[$uid]); }
function jt_mail_send($to, $subj, $text) { global $MAIL, $MAILFAIL; if ($MAILFAIL) return 'нет соединения'; $MAIL[] = [$to, $subj, $text]; return null; }
eval($c[0] . "\n" . $f1[0] . "\n" . $f2[0]);

$u = fn($id, $extra = []) => $extra + ['id' => $id, 'email' => "$id@x.ru", 'email_verified_at' => '2026-01-01',
    'telegram_id' => null, 'push_token' => null, 'is_blocked' => false];
$USERS = [
    $u('plain'),
    $u('push', ['push_token' => 'tok']),
    $u('web'),
    $u('tgok', ['telegram_id' => 1]),
    $u('tgnoconsent', ['telegram_id' => 2]),
    $u('unverified', ['email_verified_at' => null]),
    $u('blocked', ['is_blocked' => true]),
];
$WEB = [['user_id' => 'web']];
$CONSENT = ['tgok' => true];
foreach (['plain', 'plain', 'plain', 'push', 'web', 'tgok', 'tgnoconsent', 'unverified', 'blocked'] as $id) $NOTES[] = ['user_id' => $id];

$r = jt_unread_digest();
$to = array_column($MAIL, 0);
check('письмо тому, у кого нет канала', in_array('plain@x.ru', $to, true));
check('Telegram без согласия — не канал', in_array('tgnoconsent@x.ru', $to, true));
check('с пушем, web-push или Telegram — без письма',
    !array_intersect($to, ['push@x.ru', 'web@x.ru', 'tgok@x.ru']));
check('без подтверждённой почты и заблокированным — без письма',
    !array_intersect($to, ['unverified@x.ru', 'blocked@x.ru']));
check('одно письмо на человека', count($to) === count(array_unique($to)) && $r['sent'] === 2);
$plain = $MAIL[array_search('plain@x.ru', $to, true)];
check('в письме число и склонение', str_contains($plain[2], 'У вас 3 новых уведомления'));
check('в письме ссылка', str_contains($plain[2], 'https://jobtoo.ru'));

[$s1, $t1] = jt_unread_digest_mail(1); [$s5, $t5] = jt_unread_digest_mail(11); [$s21, $t21] = jt_unread_digest_mail(21);
check('склонение 1/11/21', str_contains($t1, '1 новое уведомление') && str_contains($t5, '11 новых уведомлений') && str_contains($t21, '21 новое уведомление'));

// Предел писем за раз.
$MAIL = []; $USERS = []; $NOTES = [];
for ($i = 0; $i < 130; $i++) { $USERS[] = $u("p$i"); $NOTES[] = ['user_id' => "p$i"]; }
$r = jt_unread_digest();
check('не больше JT_DIGEST_MAX писем', count($MAIL) === 100 && $r['sent'] === 100);

// Сводка — в ежедневной задаче и после ответа.
preg_match("~case 'cronDailyNudges': \\{.*?\\n        \\}\\n~s", $db, $n);
check('сводка в ежедневной задаче, после ответа', str_contains($n[0] ?? '', 'jt_defer(static function () { jt_unread_digest(); });'));
// Без содержания: функция письма не получает ни заголовков, ни текстов уведомлений.
check('в письмо не попадает содержание', !str_contains($f2[0], "'title'") && !str_contains($f2[0], "'body'"));

if ($fails) { echo "unread digest: ПРОВАЛЫ\n"; foreach ($fails as $x) echo "  - $x\n"; exit(1); }
echo "unread digest: OK\n";
