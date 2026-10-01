<?php
// Внешние отправки личных уведомлений — после ответа человеку (аудит 01.10.2026, п. 9).
$fails = [];
function check(string $name, bool $ok): void { global $fails; if (!$ok) $fails[] = $name; }
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

// Сама функция: вырезаем и исполняем в CLI — там задача идёт сразу.
preg_match('~function jt_defer\(callable \$fn\): void \{.*?\n\}\n~s', $db, $m);
check('jt_defer есть', !empty($m));
if ($m) {
    eval($m[0]);
    $ran = 0;
    jt_defer(function () use (&$ran) { $ran++; });
    check('в CLI задача выполняется сразу', $ran === 1);
}
check('под FPM ответ закрывается раньше отправок',
    str_contains($m[0] ?? '', 'fastcgi_finish_request();') && str_contains($m[0] ?? '', "PHP_SAPI !== 'fpm-fcgi'"));
check('сбой одной отправки не роняет остальные', str_contains($m[0] ?? '', 'catch (Throwable $e)'));

preg_match('~function notify_user\(.*?\n\}\n~s', $db, $n);
$body = $n[0] ?? '';
$bell = strpos($body, 'notify_bell(');
$defer = strpos($body, 'jt_defer(');
check('колокольчик пишется до ответа', $bell !== false && $defer !== false && $bell < $defer);
foreach (['tg_send_message(', 'expo_push(', 'web_push_to('] as $call) {
    $at = strpos($body, $call);
    check("$call — после ответа", $at !== false && $at > $defer);
}

// Адресные сигналы (п. 5): личное — только получателю, общее — всем.
preg_match('~function rt_touch\(.*?\n\}\n~s', $db, $t);
check('личные разделы общим каналом не объявляются',
    str_contains($t[0] ?? '', 'in_array($what, RT_PERSONAL, true)'));
foreach (['chats', 'perm_applications', 'notifications'] as $sec) {
    check("$sec — личный раздел", (bool)preg_match("~const RT_PERSONAL = \[[^\]]*'$sec'~", $db));
}
check('вакансии — по-прежнему всем', !preg_match("~const RT_PERSONAL = \[[^\]]*'perm_vacancies'~", $db));
preg_match('~function notify_bell\(.*?\n\}\n~s', $db, $b);
$sig = strpos($b[0] ?? '', 'rt_user_signal(');
$dup = strpos($b[0] ?? '', 'if ($dup) return false;');
check('сигнал получателю — и при отсеянном повторе', $sig !== false && $dup !== false && $sig < $dup);
check('сигнал в канал человека', str_contains($db, "rt_broadcast('jt:u:' . \$userId"));
$ctx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');
check('приложение слушает свой канал (веб и телефон)', substr_count($ctx, 'jt:u:${') >= 2);

if ($fails) { echo "notify defer: ПРОВАЛЫ\n"; foreach ($fails as $f) echo "  - $f\n"; exit(1); }
echo "notify defer: OK\n";
