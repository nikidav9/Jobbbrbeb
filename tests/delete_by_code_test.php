<?php
// Удаление аккаунта кодом из письма (01.10.2026, решение владельца: «приходит
// код на почту, вводишь — и аккаунт удалён»). Проверка текстовая: живой базы
// отсюда нет. Сторожит три вещи, без которых удаление по коду опасно:
// код уходит только на свою подтверждённую почту, удаляется только свой
// аккаунт, и код удаления нельзя превратить в квитанцию через общий verify.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

require __DIR__ . '/../php-proxy/auth_email.php';
check('delete — цель из общего списка', in_array('delete', JT_AUTH_PURPOSES, true));

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$send = substr($db, (int)strpos($db, "case 'dbAuthSendCode':"), 2500);
check('код удаления только из сессии',
    str_contains($send, "if (\$purpose === 'delete') {")
    && str_contains($send, "if (\$authUid === null) { jt_respond(['error' => 'Authentication required'], 401); exit; }"));
check('адрес берётся из аккаунта, а не из запроса', str_contains($send, "\$args[0] = (string)\$me['email'];"));
check('нужна подтверждённая почта', str_contains($send, "empty(\$me['email_verified_at'])"));
check('код выпускается на свой аккаунт', str_contains($db, "if (\$purpose === 'delete') \$userId = (string)\$authUid;"));

$verify = substr($db, (int)strpos($db, "case 'dbAuthVerifyCode':"), 1500);
check('общий verify не принимает delete', str_contains($verify, "if (\$purpose === 'delete') { jt_respond(['error' => 'Неизвестная цель'], 400); exit; }"));

check('dbDeleteAccountByCode сверяет uid с сессией', (bool)preg_match("~'dbDeleteAccountByCode' => 0~", $db));
$del = substr($db, (int)strpos($db, "case 'dbDeleteAccountByCode':"), 2000);
check('код проверяется на цель delete', str_contains($del, "jt_auth_check_code(\$email, 'delete',"));
check('неверный код считается попыткой', str_contains($del, "jt_try_note('code');"));
check('код выпущен для этого аккаунта', str_contains($del, "if ((string)(\$res['user_id'] ?? '') !== \$uid) {"));
check('файлы удаляются вместе с аккаунтом', str_contains($del, 'jt_purge_user_storage($uid);'));
check('порядок: проверка до удаления',
    strpos($del, 'jt_auth_check_code') < strpos($del, "sb_rpc('jm_delete_account'"));

$mig = (string)@file_get_contents(__DIR__ . '/../supabase/migrations/140_auth_code_delete.sql');
check('миграция разрешает цель delete', str_contains($mig, "'login', 'delete'"));

if ($failures) {
    echo "delete_by_code: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "delete_by_code: OK\n";
