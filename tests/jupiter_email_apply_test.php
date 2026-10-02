<?php
ini_set('error_log', '/dev/null');
// Отклик письмом (п.4, решение владельца 01.10.2026): адрес только на домене
// вакансии, только по разрешению отправки, письмо — из того, что человек
// указал сам, резюме во вложении, Reply-To — личный адрес JobToo. Письмо
// уходит на подставной SMTP-сервер, который пишет диалог.

require __DIR__ . '/../php-proxy/mailer.php';
require __DIR__ . '/../php-proxy/jupiter_email_apply.php';

$fails = 0;
function check(string $name, bool $ok): void
{
    global $fails;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    if (!$ok) $fails++;
}

// ── Адрес ────────────────────────────────────────────────────────────────
check('HR-почта домена вакансии', jt_email_apply_domain_ok('rabota@sibur.ru', 'https://career.sibur.ru/vacancies/1'));
check('домен второго уровня ru-зоны', jt_email_apply_domain_ok('hr@x.com.ru', 'https://job.x.com.ru/v'));
check('чужой домен — нет', !jt_email_apply_domain_ok('hr.123@gmail.com', 'https://job.ginza.ru/'));
check('похожий домен — нет', !jt_email_apply_domain_ok('hr@sibur.ru.evil.com', 'https://career.sibur.ru/'));
check('перевод строки — нет', !jt_email_apply_domain_ok("hr@sibur.ru\r\nBcc: a@b.ru", 'https://sibur.ru/'));

// ── Текст ────────────────────────────────────────────────────────────────
[$subject, $text, $from] = jt_email_apply_letter(
    ['first_name' => 'Пётр', 'last_name' => 'Иванов', 'phone' => '+79991234567'],
    'Сибур', 'https://career.sibur.ru/vacancies/1', 'petr.ivanov@jobtoo.ru');
check('тема с именем', $subject === 'Отклик на вакансию — Пётр Иванов');
check('подпись отправителя «через JobToo»', $from === 'Пётр Иванов через JobToo');
check('ссылка, телефон и личный адрес в тексте', str_contains($text, 'https://career.sibur.ru/vacancies/1')
    && str_contains($text, '+79991234567') && str_contains($text, 'petr.ivanov@jobtoo.ru'));
[, $noPhone] = jt_email_apply_letter(['first_name' => 'Пётр'], '', 'https://x.ru/v', 'p@jobtoo.ru');
check('нет телефона в профиле — нет строки телефона', !str_contains($noPhone, 'Телефон'));

// ── Потолок ──────────────────────────────────────────────────────────────
$capFile = sys_get_temp_dir() . '/jt-cap-test-' . getmypid() . '.json';
@unlink($capFile);
$taken = 0;
for ($i = 0; $i < JT_EMAIL_APPLY_PER_HOUR + 5; $i++) $taken += jt_email_apply_cap_take($capFile, 1000) ? 1 : 0;
check('потолок писем в час', $taken === JT_EMAIL_APPLY_PER_HOUR);
check('через час — снова можно', jt_email_apply_cap_take($capFile, 1000 + 3600));
@unlink($capFile);

// ── Отправка: условия ────────────────────────────────────────────────────
$sent = [];
$deps = [
    'user' => fn($u) => ['first_name' => 'Пётр', 'last_name' => 'Иванов', 'phone' => ''],
    'mailbox' => fn($u) => 'petr.ivanov@jobtoo.ru',
    'resume' => fn($u) => ['cv.pdf', "%PDF-1.4 test"],
    'cap' => fn() => true,
    'send' => function (...$a) use (&$sent) { $sent[] = $a; return null; },
];
$task = ['user_id' => 'u1', 'vacancy_url' => 'https://career.sibur.ru/v/1', 'company' => 'Сибур',
    'submission_authorized_at' => '2026-10-01T00:00:00Z'];
check('без разрешения отправки — не шлём',
    jt_email_apply_send(['submission_authorized_at' => null] + $task, 'rabota@sibur.ru', $deps) === 'отправка не разрешена' && !$sent);
check('чужой домен — не шлём',
    jt_email_apply_send($task, 'hr@gmail.com', $deps) === 'адрес не на домене вакансии' && !$sent);
check('нет резюме — не шлём',
    jt_email_apply_send($task, 'rabota@sibur.ru', ['resume' => fn($u) => null] + $deps) === 'резюме PDF недоступно' && !$sent);
check('потолок исчерпан — не шлём',
    jt_email_apply_send($task, 'rabota@sibur.ru', ['cap' => fn() => false] + $deps) !== null && !$sent);
check('всё есть — письмо ушло', jt_email_apply_send($task, 'rabota@sibur.ru', $deps) === null && count($sent) === 1);
$opts = $sent[0][3] ?? [];
check('Reply-To — личный адрес, вложение — резюме', ($opts['reply_to'] ?? '') === 'petr.ivanov@jobtoo.ru'
    && ($opts['attachments'][0][0] ?? '') === 'cv.pdf' && ($opts['attachments'][0][1] ?? '') === 'application/pdf');

// ── Письмо с вложением: настоящий SMTP-диалог ────────────────────────────
$port = 20000 + random_int(0, 20000);
$log = sys_get_temp_dir() . '/jt-smtp-apply-' . $port . '.log';
@unlink($log);
$server = <<<'PHP'
$port = (int)$argv[1]; $log = $argv[2];
$srv = stream_socket_server("tcp://127.0.0.1:$port", $en, $es);
file_put_contents($log . '.ready', '1');
$c = stream_socket_accept($srv, 10);
$w = function ($s) use ($c) { fwrite($c, $s . "\r\n"); };
$w('220 test ESMTP');
$data = false; $stage = '';
while (($l = fgets($c)) !== false) {
    file_put_contents($log, $l, FILE_APPEND);
    if ($data) { if (rtrim($l, "\r\n") === '.') { $data = false; $w('250 queued'); } continue; }
    $cmd = strtoupper(substr(trim($l), 0, 4));
    if ($stage === 'user') { $stage = 'pass'; $w('334 UGFzc3dvcmQ6'); continue; }
    if ($stage === 'pass') { $stage = ''; $w('235 ok'); continue; }
    if ($cmd === 'EHLO') { $w('250-test'); $w('250 AUTH LOGIN'); }
    elseif ($cmd === 'AUTH') { $stage = 'user'; $w('334 VXNlcm5hbWU6'); }
    elseif ($cmd === 'MAIL' || $cmd === 'RCPT') $w('250 ok');
    elseif ($cmd === 'DATA') { $data = true; $w('354 go'); }
    elseif ($cmd === 'QUIT') { $w('221 bye'); break; }
    else $w('500 ?');
}
PHP;
$proc = proc_open([PHP_BINARY, '-r', $server, (string)$port, $log], [], $pipes);
for ($i = 0; $i < 50 && !is_file($log . '.ready'); $i++) usleep(100000);
$cfg = ['host' => '127.0.0.1', 'port' => $port, 'transport' => 'tcp',
    'user' => 'support@jobtoo.ru', 'pass' => 'x', 'timeout' => 5];
$pdf = "%PDF-1.4\n" . str_repeat('резюме ', 50);
$err = jt_mail_send('rabota@sibur.ru', 'Отклик на вакансию — Пётр Иванов', "Здравствуйте!\n.\nТочка в начале строки", $cfg, false, $l2, [
    'from_name' => 'Пётр Иванов через JobToo', 'reply_to' => 'petr.ivanov@jobtoo.ru',
    'attachments' => [["cv\"\r\nX: y.pdf", 'application/pdf', $pdf]],
]);
proc_close($proc);
$dialog = (string)@file_get_contents($log);
@unlink($log); @unlink($log . '.ready');
check('письмо с вложением ушло: ' . (string)$err, $err === null);
check('отправитель — ящик входа (правило Timeweb)', str_contains($dialog, 'MAIL FROM:<support@jobtoo.ru>'));
check('подпись отправителя — имя кандидата', str_contains($dialog, 'From: =?UTF-8?B?' . base64_encode('Пётр Иванов через JobToo') . '?= <support@jobtoo.ru>'));
check('Reply-To — личный адрес', str_contains($dialog, "Reply-To: <petr.ivanov@jobtoo.ru>\r\n"));
check('multipart с PDF', str_contains($dialog, 'Content-Type: multipart/mixed; boundary=')
    && str_contains($dialog, 'Content-Type: application/pdf; name='));
check('имя файла не ломает заголовки', !str_contains($dialog, "\r\nX: y.pdf"));
preg_match_all("~Content-Transfer-Encoding: base64\r\n\r\n(.*?)\r\n--~s", $dialog, $m);
check('текст и файл целы', count($m[1]) === 2
    && str_contains((string)base64_decode(str_replace("\r\n", '', $m[1][0])), "\n.\nТочка")
    && base64_decode(str_replace("\r\n", '', $m[1][1])) === $pdf);
check('некорректный Reply-To — отказ до соединения',
    jt_mail_send('a@b.ru', 'Т', 'Т', $cfg, false, $l3, ['reply_to' => "x@y.ru\r\nBcc: z@z.ru"]) === 'некорректный адрес ответа');

// ── Проводка в db.php ────────────────────────────────────────────────────
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('jupiterFinish шлёт письмо только при EMAIL_APPLY и разрешении',
    (bool)preg_match("~'EMAIL_APPLY'\s*\n\s*&& !empty\(\\\$task\['submission_authorized_at'\]\)\)\s*\{\s*\n\s*\\\$err = jt_email_apply_send~", $db));
check('jupiterFinish берёт vacancy_url задачи для проверки домена',
    str_contains($db, "'lease_owner,user_id,engine,submission_authorized_at,company,vacancy_url'"));

echo $fails ? "\n$fails FAILED\n" : "\nall ok\n";
exit($fails ? 1 : 0);
