<?php
// Отправка писем: коды входа, регистрации и восстановления пароля.
//
// SMTP Timeweb с ящика support@jobtoo.ru (решение владельца 25.09.2026):
// логин и пароль уже лежат в /opt/jobtoo-secrets/env как JUPITER_MAIL_IMAP_*
// — этим же ящиком Jupiter читает входящие, — docker-compose отдаёт их PHP как
// MAIL_SMTP_USER / MAIL_SMTP_PASSWORD. Timeweb требует, чтобы отправитель
// совпадал с учётной записью, поэтому From — тот же адрес.
//
// Своя маленькая реализация, а не библиотека: нужна одна операция (одно
// текстовое письмо одному адресату), а новая зависимость на сервере — это
// ещё одна вещь, которую надо ставить и обновлять. Данные остаются в РФ.

/**
 * Одно текстовое письмо. Возвращает null при успехе или причину отказа.
 *
 * $cfg — для тестов (transport tcp на 127.0.0.1 без TLS); в бою берётся из
 * окружения, ssl:// на 465.
 */
function jt_mail_config(): array
{
    return [
        'host' => getenv('MAIL_SMTP_HOST') ?: 'smtp.timeweb.ru',
        'port' => (int)(getenv('MAIL_SMTP_PORT') ?: 465),
        'transport' => 'ssl',
        'user' => (string)getenv('MAIL_SMTP_USER'),
        'pass' => (string)getenv('MAIL_SMTP_PASSWORD'),
        // Письмо уходит внутри запроса к API, а обработчиков PHP всего
        // несколько. Зависший почтовый сервер не должен держать их по
        // полминуты: соединение — 5 с, всё письмо целиком — не дольше 10 с.
        'timeout' => 5,
        'deadline' => 10,
    ];
}

function jt_mail_send(string $to, string $subject, string $text, ?array $cfg = null, bool $probeOnly = false): ?string
{
    $cfg ??= jt_mail_config();
    $user = (string)($cfg['user'] ?? '');
    if ($user === '' || (string)($cfg['pass'] ?? '') === '') return 'почта не настроена';
    // Адресат идёт в команду RCPT TO и в заголовок — никаких переводов строк
    // и угловых скобок, иначе это инъекция команд SMTP.
    if (!$probeOnly && (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n<>]/', $to))) return 'некорректный адрес';
    $until = microtime(true) + (float)($cfg['deadline'] ?? 10);

    $ctx = stream_context_create(['ssl' => [
        'verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $cfg['host'],
    ]]);
    $errno = 0; $errstr = '';
    $sock = @stream_socket_client($cfg['transport'] . '://' . $cfg['host'] . ':' . $cfg['port'],
        $errno, $errstr, (float)$cfg['timeout'], STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return "нет соединения с почтовым сервером ($errno $errstr)";

    // Ответ SMTP может быть многострочным: «250-…» продолжение, «250 …» конец.
    // Каждое чтение ограничено остатком общего срока: молчащий сервер
    // возвращает код 0, и отправка обрывается.
    $read = function () use ($sock, $until): array {
        $all = '';
        while (true) {
            $left = $until - microtime(true);
            if ($left <= 0) return [0, 'почтовый сервер не ответил вовремя'];
            stream_set_timeout($sock, (int)max(1, ceil($left)));
            $line = fgets($sock, 1024);
            if ($line === false) {
                return [0, stream_get_meta_data($sock)['timed_out'] ? 'почтовый сервер не ответил вовремя' : 'соединение оборвалось'];
            }
            $all .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;
        }
        return [(int)substr($all, 0, 3), trim($all)];
    };
    $cmd = function (string $line, int $want) use ($sock, $read): ?string {
        fwrite($sock, $line . "\r\n");
        [$code, $reply] = $read();
        return $code === $want ? null : "почтовый сервер ответил $code на " . strtok($line, ' ') . ": $reply";
    };

    try {
        [$code, $greet] = $read();
        if ($code !== 220) return "почтовый сервер не поздоровался: $greet";
        if ($e = $cmd('EHLO jobtoo.ru', 250)) return $e;
        if ($e = $cmd('AUTH LOGIN', 334)) return $e;
        if ($e = $cmd(base64_encode($user), 334)) return $e;
        if ($e = $cmd(base64_encode((string)$cfg['pass']), 235)) return 'почтовый сервер не принял логин';
        // Проверка после выкладки (adminMailCheck): соединение, TLS и вход —
        // без письма.
        if ($probeOnly) { fwrite($sock, "QUIT\r\n"); return null; }
        if ($e = $cmd('MAIL FROM:<' . $user . '>', 250)) return $e;
        if ($e = $cmd('RCPT TO:<' . $to . '>', 250)) return $e;
        if ($e = $cmd('DATA', 354)) return $e;

        $headers = [
            'From: =?UTF-8?B?' . base64_encode('JobToo') . '?= <' . $user . '>',
            'To: <' . $to . '>',
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@jobtoo.ru>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            // base64 — строки короткие, и точка в начале строки (конец письма
            // в SMTP) в теле появиться не может.
            'Content-Transfer-Encoding: base64',
        ];
        $body = rtrim(chunk_split(base64_encode($text), 76, "\r\n"));
        fwrite($sock, implode("\r\n", $headers) . "\r\n\r\n" . $body . "\r\n.\r\n");
        [$code, $reply] = $read();
        if ($code !== 250) return "почтовый сервер не принял письмо: $reply";
        fwrite($sock, "QUIT\r\n");
        return null;
    } finally {
        fclose($sock);
    }
}

/** Письмо с кодом: текст под каждую цель. */
function jt_mail_code(string $to, string $code, string $purpose, ?array $cfg = null): ?string
{
    $what = [
        'register' => ['Код для регистрации в JobToo', 'Ваш код для регистрации в JobToo:'],
        'attach'   => ['Подтверждение почты в JobToo', 'Ваш код для подтверждения почты в JobToo:'],
        'reset'    => ['Восстановление пароля JobToo', 'Ваш код для восстановления пароля в JobToo:'],
    ][$purpose] ?? ['Код JobToo', 'Ваш код JobToo:'];
    $text = $what[1] . "\n\n    " . $code . "\n\n"
        . "Код действует 10 минут. Никому его не сообщайте — сотрудники JobToo\n"
        . "его никогда не спрашивают.\n\n"
        . "Если вы ничего не запрашивали, просто удалите это письмо.\n\n"
        . "— JobToo, jobtoo.ru\n";
    return jt_mail_send($to, $what[0], $text, $cfg);
}
