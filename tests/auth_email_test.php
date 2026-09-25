<?php
ini_set('error_log', '/dev/null');
// Вход по почте: коды из писем, квитанции, отправка письма.
//
// Решение владельца 25.09.2026: регистрация и восстановление пароля — по коду
// из письма. Ошибка здесь стоит дорого в обе стороны: слабый код — это вход в
// чужой аккаунт, сломанный — ни одной новой регистрации. Поэтому проверяем
// поведение, а не наличие строк: коды выпускаются и сверяются на заглушке
// базы, письмо уходит на подставной SMTP-сервер, который пишет диалог.

// ── Заглушка базы (sb_lite.php обёрнут в if (!function_exists('sb'))) ───────
$GLOBALS['T'] = ['jm_auth_codes' => [], 'jm_users' => []];
function sb(string $m, string $t, array $q = [], $b = null, array $e = []): array { return []; }
function stub_ok(array $r, array $f): bool
{
    foreach ($f as $col => $cond) {
        if (in_array($col, ['order', 'limit', 'select'], true)) continue;
        $cond = (string)$cond; $v = $r[$col] ?? null;
        if (str_starts_with($cond, 'eq.')) { if ((string)$v !== substr($cond, 3)) return false; }
        elseif ($cond === 'is.null') { if ($v !== null) return false; }
        elseif (str_starts_with($cond, 'gt.')) { if (!((string)$v > substr($cond, 3))) return false; }
        else throw new RuntimeException("заглушка не знает фильтра $col=$cond");
    }
    return true;
}
function sb_select(string $t, array $f = [], string $sel = '*', ?string $ord = null): array
{
    $rows = array_values(array_filter($GLOBALS['T'][$t] ?? [], fn($r) => stub_ok($r, $f)));
    $ord ??= $f['order'] ?? null;
    if ($ord === 'created_at.desc') usort($rows, fn($a, $b) => strcmp($b['created_at'], $a['created_at']) ?: strcmp($b['id'], $a['id']));
    if (isset($f['limit'])) $rows = array_slice($rows, 0, (int)$f['limit']);
    return $rows;
}
function sb_single(string $t, array $f = [], string $sel = '*'): ?array { return sb_select($t, $f + ['limit' => '1'])[0] ?? null; }
function sb_insert(string $t, array $row): void { $GLOBALS['T'][$t][] = $row + ['attempts' => 0, 'consumed_at' => null]; }
function sb_update(string $t, array $f, array $d): void
{
    foreach ($GLOBALS['T'][$t] as $i => $r) if (stub_ok($r, $f)) $GLOBALS['T'][$t][$i] = array_merge($r, $d);
}

require_once __DIR__ . '/../php-proxy/auth_email.php';
require_once __DIR__ . '/../php-proxy/mailer.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$key = 'test-key';
$sent = [];
$mail = function (string $to, string $code, string $p) use (&$sent): ?string { $sent[] = [$to, $code, $p]; return null; };
/** Состарить все коды адреса на $sec секунд — вместо ожидания. */
$age = function (int $sec): void {
    foreach ($GLOBALS['T']['jm_auth_codes'] as $i => $r) {
        foreach (['created_at', 'expires_at'] as $k) {
            $GLOBALS['T']['jm_auth_codes'][$i][$k] = gmdate('Y-m-d\TH:i:s\Z', strtotime($r[$k]) - $sec);
        }
    }
};

// ── Адрес ───────────────────────────────────────────────────────────────────
check('почта приводится к нижнему регистру и без пробелов', jt_email_norm('  Ivan.Petrov@Mail.RU ') === 'ivan.petrov@mail.ru');
foreach (['', 'ivan', 'ivan@', "a@b.ru\r\nRCPT TO:<x@y.ru>", 'a b@c.ru', '<a@b.ru>'] as $bad) {
    check('негодный адрес отвергнут: ' . json_encode($bad), jt_email_norm($bad) === null);
}

// ── Выпуск кода ──────────────────────────────────────────────────────────────
$r = jt_auth_issue_code('ivan@mail.ru', 'register', null, $key, $mail);
check('код выпущен и письмо ушло', $r['ok'] === true && count($sent) === 1);
$code1 = $sent[0][1] ?? '';
check('код — шесть цифр', preg_match('/^\d{6}$/', $code1) === 1);
$row = $GLOBALS['T']['jm_auth_codes'][0];
check('в базе не код, а его подпись', !str_contains(json_encode($row), $code1) && strlen($row['code_hash']) === 64);
check('код живёт 10 минут', abs(strtotime($row['expires_at']) - strtotime($row['created_at']) - 600) <= 1);

$r = jt_auth_issue_code('ivan@mail.ru', 'register', null, $key, $mail);
check('повторно раньше минуты — нельзя', $r['ok'] === false && $r['reason'] === 'wait' && $r['retry_in'] > 0);
$age(61);
$r = jt_auth_issue_code('ivan@mail.ru', 'register', null, $key, $mail);
check('через минуту — можно', $r['ok'] === true);
$code2 = end($sent)[1];

check('после повторной отправки старый код недействителен',
    $code1 === $code2 || jt_auth_check_code('ivan@mail.ru', 'register', $code1, $key)['ok'] === false);
check('код другой цели не подходит', jt_auth_check_code('ivan@mail.ru', 'reset', $code2, $key)['ok'] === false);
$ok = jt_auth_check_code('ivan@mail.ru', 'register', $code2, $key);
check('верный код принят', $ok['ok'] === true);
check('принятый код второй раз не принимается', jt_auth_check_code('ivan@mail.ru', 'register', $code2, $key)['ok'] === false);

// Пять в час на адрес и цель.
$GLOBALS['T']['jm_auth_codes'] = []; $sent = [];
for ($i = 0; $i < 5; $i++) { jt_auth_issue_code('a@b.ru', 'reset', 'u1', $key, $mail); $age(61); }
$r = jt_auth_issue_code('a@b.ru', 'reset', 'u1', $key, $mail);
check('шестой код за час не выпускается', $r['ok'] === false && $r['reason'] === 'too_many' && count($sent) === 5);

// ── Сверка: попытки и срок ───────────────────────────────────────────────────
$GLOBALS['T']['jm_auth_codes'] = []; $sent = [];
jt_auth_issue_code('c@d.ru', 'attach', 'u7', $key, $mail);
$right = $sent[0][1];
$wrong = str_pad((string)(((int)$right + 1) % 1000000), 6, '0', STR_PAD_LEFT);
$last = null;
for ($i = 0; $i < 5; $i++) $last = jt_auth_check_code('c@d.ru', 'attach', $wrong, $key);
check('пять неверных — код сгорел', $last['reason'] === 'too_many_attempts');
check('после пяти неверных и верный не проходит', jt_auth_check_code('c@d.ru', 'attach', $right, $key)['ok'] === false);

$GLOBALS['T']['jm_auth_codes'] = []; $sent = [];
jt_auth_issue_code('e@f.ru', 'attach', 'u7', $key, $mail);
$r = jt_auth_check_code('e@f.ru', 'attach', $wrong === $sent[0][1] ? '000000' : $wrong, $key);
check('неверный код говорит, сколько попыток осталось', $r['reason'] === 'wrong_code' && $r['left'] === 4);
$ok = jt_auth_check_code('e@f.ru', 'attach', ' ' . substr($sent[0][1], 0, 3) . ' ' . substr($sent[0][1], 3) . ' ', $key);
check('код с пробелами (так его копируют из письма) принят и знает, чей он', $ok['ok'] === true && $ok['user_id'] === 'u7');

$GLOBALS['T']['jm_auth_codes'] = []; $sent = [];
jt_auth_issue_code('g@h.ru', 'reset', 'u9', $key, $mail);
$age(601);
check('через 10 минут код устарел', jt_auth_check_code('g@h.ru', 'reset', $sent[0][1], $key)['reason'] === 'expired');

// Письмо не ушло — пауза не держит, можно сразу ещё раз.
$GLOBALS['T']['jm_auth_codes'] = [];
$fail = fn(string $to, string $c, string $p): ?string => 'нет соединения';
$r = jt_auth_issue_code('i@j.ru', 'register', null, $key, $fail);
check('сбой почты — понятная причина', $r['ok'] === false && $r['reason'] === 'mail_failed');
check('код из неотправленного письма не действует', jt_auth_check_code('i@j.ru', 'register', '123456', $key)['ok'] === false);
check('после сбоя почты можно сразу попробовать снова', jt_auth_issue_code('i@j.ru', 'register', null, $key, $mail)['ok'] === true);

// ── Квитанция ────────────────────────────────────────────────────────────────
$t = jt_auth_ticket_issue('ivan@mail.ru', 'reset', 'u1', $key);
check('квитанция проверяется под свою цель', jt_auth_ticket_check($t, 'reset', $key) === ['email' => 'ivan@mail.ru', 'uid' => 'u1']);
check('квитанция не годится под чужую цель', jt_auth_ticket_check($t, 'register', $key) === null);
check('квитанция не годится с чужим ключом', jt_auth_ticket_check($t, 'reset', 'other') === null);
[$p, $sig] = explode('.', $t);
$forged = rtrim(strtr(base64_encode(json_encode(['t' => 'email', 'e' => 'boss@jobtoo.ru', 'p' => 'reset', 'u' => 'admin', 'exp' => time() + 999])), '+/', '-_'), '=');
check('подменённое содержимое не проходит', jt_auth_ticket_check($forged . '.' . $sig, 'reset', $key) === null);
// Токен сессии подписан тем же ключом, но другой приставкой — квитанцией не станет.
$sess = $p . '.' . rtrim(strtr(base64_encode(hash_hmac('sha256', $p, $key, true)), '+/', '-_'), '=');
check('токен сессии не выдаётся за квитанцию', jt_auth_ticket_check($sess, 'reset', $key) === null);
$old = rtrim(strtr(base64_encode(json_encode(['t' => 'email', 'e' => 'a@b.ru', 'p' => 'reset', 'u' => 'u1', 'exp' => time() - 1])), '+/', '-_'), '=');
check('просроченная квитанция не проходит', jt_auth_ticket_check($old . '.' . hash_hmac('sha256', 'email-ticket|' . $old, $key), 'reset', $key) === null);

// ── Пароль: те же правила, что на экране (constants/passwordRules.ts) ────────
check('короткий пароль отвергнут', jt_password_problem('abc123') !== null);
check('без цифры отвергнут', jt_password_problem('abcdefgh') !== null);
check('без буквы отвергнут', jt_password_problem('12345678') !== null);
check('кириллица с цифрой принята', jt_password_problem('пароль2026') === null);
check('латиница с цифрой принята', jt_password_problem('Jobtoo2026') === null);

// ── Письмо: настоящий SMTP-диалог с подставным сервером ─────────────────────
$port = 20000 + random_int(0, 20000);
$log = sys_get_temp_dir() . '/jt-smtp-' . $port . '.log';
@unlink($log);
$server = <<<'PHP'
$port = (int)$argv[1]; $log = $argv[2]; $pass = $argv[3];
$srv = stream_socket_server("tcp://127.0.0.1:$port", $en, $es);
file_put_contents($log . '.ready', '1');
$c = stream_socket_accept($srv, 10);
$w = function ($s) use ($c) { fwrite($c, $s . "\r\n"); };
$w('220 test ESMTP');
$data = false; $body = ''; $stage = '';
while (($l = fgets($c)) !== false) {
    file_put_contents($log, $l, FILE_APPEND);
    if ($data) { if (rtrim($l, "\r\n") === '.') { $data = false; $w('250 queued'); } continue; }
    $cmd = strtoupper(substr(trim($l), 0, 4));
    if ($stage === 'user') { $stage = 'pass'; $w('334 UGFzc3dvcmQ6'); continue; }
    if ($stage === 'pass') { $stage = ''; $w(base64_decode(trim($l)) === $pass ? '235 ok' : '535 bad'); continue; }
    if ($cmd === 'EHLO') { $w('250-test'); $w('250 AUTH LOGIN'); }
    elseif ($cmd === 'AUTH') { $stage = 'user'; $w('334 VXNlcm5hbWU6'); }
    elseif ($cmd === 'MAIL' || $cmd === 'RCPT') $w('250 ok');
    elseif ($cmd === 'DATA') { $data = true; $w('354 go'); }
    elseif ($cmd === 'QUIT') { $w('221 bye'); break; }
    else $w('500 ?');
}
PHP;
$spawn = function (string $pass) use ($server, $port, $log) {
    @unlink($log . '.ready');
    $proc = proc_open([PHP_BINARY, '-r', $server, (string)$port, $log, $pass], [], $pipes);
    for ($i = 0; $i < 50 && !is_file($log . '.ready'); $i++) usleep(100000);
    return $proc;
};
$cfg = ['host' => '127.0.0.1', 'port' => $port, 'transport' => 'tcp',
    'user' => 'support@jobtoo.ru', 'pass' => 'секрет-123', 'timeout' => 5];

$proc = $spawn('секрет-123');
$err = jt_mail_code('ivan@mail.ru', '042917', 'register', $cfg);
proc_close($proc);
$dialog = (string)@file_get_contents($log);
check('письмо ушло без ошибок: ' . (string)$err, $err === null);
check('вход на почтовый сервер под ящиком support@', str_contains($dialog, base64_encode('support@jobtoo.ru')));
check('отправитель совпадает с ящиком (правило Timeweb)', str_contains($dialog, 'MAIL FROM:<support@jobtoo.ru>'));
check('адресат — ровно тот, кто просил', str_contains($dialog, 'RCPT TO:<ivan@mail.ru>'));
check('тема в UTF-8', str_contains($dialog, 'Subject: =?UTF-8?B?' . base64_encode('Код для регистрации в JobToo') . '?='));
$b64 = '';
if (preg_match("~Content-Transfer-Encoding: base64\r\n\r\n(.*?)\r\n\.\r\n~s", $dialog, $m)) $b64 = str_replace("\r\n", '', $m[1]);
$text = (string)base64_decode($b64);
check('в тексте письма есть код', str_contains($text, '042917'));
check('в тексте письма сказано про срок и что код никому не сообщать',
    str_contains($text, '10 минут') && str_contains($text, 'Никому его не сообщайте'));
@unlink($log);

$proc = $spawn('другой-пароль');
$err = jt_mail_send('ivan@mail.ru', 'Тема', 'Текст', $cfg);
proc_close($proc);
check('неверный пароль ящика — ошибка, а не молчание', $err === 'почтовый сервер не принял логин');
@unlink($log);

check('перевод строки в адресате — отказ до соединения',
    jt_mail_send("ivan@mail.ru\r\nRCPT TO:<evil@x.ru>", 'Т', 'Т', $cfg) === 'некорректный адрес');
check('без логина почты — честный отказ', jt_mail_send('ivan@mail.ru', 'Т', 'Т', ['user' => '', 'pass' => ''] + $cfg) === 'почта не настроена');

// ── Проводка в db.php ────────────────────────────────────────────────────────
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}
check('код, сверка и сброс доступны до входа',
    preg_match("~\\\$publicFns = \[.*?'dbAuthSendCode', 'dbAuthVerifyCode', 'dbAuthResetPassword',.*?\];~s", $db) === 1);
check('привязка почты — только с сессией (не в публичных)',
    !preg_match("~\\\$publicFns = \[[^\]]*'dbAuthAttachEmail'~s", $db));
check('телефон для связи меняет только владелец', str_contains($db, "'dbSetContactPhone' => 0"));

$send = case_body($db, 'dbAuthSendCode');
check('сброс не выдаёт, есть ли такая почта',
    str_contains($send, "if (!\$owner || !empty(\$owner['is_blocked'])) { \$data = ['ok' => true]; break; }"));
check('регистрация на занятую почту — отказ', str_contains($send, "if (\$purpose === 'register' && \$owner) {"));
check('привязка требует сессии и чужую почту не берёт',
    str_contains($send, "if (\$authUid === null) { jt_respond(['error' => 'Authentication required'], 401); exit; }")
    && str_contains($send, 'Эта почта уже привязана к другому аккаунту'));
check('письма с одного адреса ограничены', str_contains($send, "jt_try_blocked('mail')") && str_contains($send, "jt_try_note('mail')"));
check('попытка считается до ответа «почта занята» — перебор адресов ограничен',
    strpos($send, "jt_try_note('mail')") !== false
    && strpos($send, "jt_try_note('mail')") < strpos($send, "if (\$purpose === 'register' && \$owner) {"));

$verify = case_body($db, 'dbAuthVerifyCode');
check('неверные коды с одного адреса ограничены', str_contains($verify, "jt_try_blocked('code')") && str_contains($verify, "jt_try_note('code')"));
check('код привязки из чужой сессии не принимается',
    str_contains($verify, "if (\$purpose === 'attach' && (string)(\$res['user_id'] ?? '') !== (string)\$authUid) {"));

$reset = case_body($db, 'dbAuthResetPassword');
check('сброс пароля гасит прежние сессии', str_contains($reset, "'sessions_valid_from' => now_iso(),"));
check('сброс проверяет пароль сервером', str_contains($reset, 'jt_password_problem($new)'));
check('сброс — только по квитанции reset', str_contains($reset, "jt_auth_ticket_check((string)(\$args[0] ?? ''), 'reset', jt_session_key())"));

$attach = case_body($db, 'dbAuthAttachEmail');
check('привязка — только своей квитанцией', str_contains($attach, "(string)\$t['uid'] !== (string)\$authUid"));

$upsert = case_body($db, 'dbUpsertUser');
check('регистрация по квитанции register ставит подтверждённую почту',
    str_contains($upsert, "jt_auth_ticket_check(\$args[3], 'register', jt_session_key())")
    && str_contains($upsert, "\$u['email_verified_at'] = now_iso();"));
check('почту в профиль через обычное сохранение не подсунуть',
    preg_match("~\\\$editable = \[[^\]]*'email'~s", $upsert) === 0 && preg_match("~\\\$atCreate = \[[^\]]*'email'~s", $upsert) === 0);

$login = case_body($db, 'dbLogin');
check('вход по почте или по телефону старого аккаунта',
    str_contains($login, "sb_single('jm_users', ['email' => 'eq.' . \$email])")
    && str_contains($login, "sb_single('jm_users', ['phone' => 'eq.' . \$phone])"));

$phone = case_body($db, 'dbSetContactPhone');
check('без подтверждённой почты телефон-вход не стереть и не сменить',
    str_contains($phone, "if (empty(\$me['email_verified_at']) && (string)(\$me['phone'] ?? '') !== \$digits) {"));

$compose = (string)file_get_contents(__DIR__ . '/../infra/docker-compose.yml');
check('PHP получает логин и пароль ящика из секретов',
    str_contains($compose, 'MAIL_SMTP_USER: ${JUPITER_MAIL_IMAP_USER:-}')
    && str_contains($compose, 'MAIL_SMTP_PASSWORD: ${JUPITER_MAIL_IMAP_PASSWORD:-}'));

$mig = (string)file_get_contents(__DIR__ . '/../supabase/migrations/119_email_auth.sql');
check('почта стирается при удалении аккаунта', str_contains($mig, 'new.email := null;'));
check('таблица кодов закрыта от anon', str_contains($mig, 'revoke all on public.jm_auth_codes from anon, authenticated;'));

if ($failures) {
    echo "auth email: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "auth email: OK\n";
