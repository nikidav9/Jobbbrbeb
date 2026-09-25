<?php
// Коды из писем: регистрация, привязка почты к старому аккаунту, сброс пароля.
//
// Решение владельца 25.09.2026: вход по почте, код приходит письмом. Здесь —
// правила, которые легко проверить без сети: сколько живёт код, сколько
// попыток, как часто можно просить новый, чем подтверждается пройденная
// проверка. db.php зовёт эти функции и отвечает клиенту.
//
// Два шага, а не один. Код сверяется сразу (dbAuthVerifyCode), и в ответ
// приходит «квитанция» — подписанный сервером факт «эта почта подтверждена
// для такой-то цели». Её предъявляют на последнем шаге: регистрация после
// ввода имени и пароля, новый пароль, привязка. Иначе человек заполнял бы всю
// анкету и только в конце узнавал, что код неверный.

const JT_CODE_TTL = 600;           // код живёт 10 минут
const JT_CODE_ATTEMPTS = 5;        // попыток на один код
const JT_CODE_RESEND = 60;         // новый код не чаще раза в минуту
const JT_CODE_PER_HOUR = 5;        // и не больше пяти в час на адрес и цель
// Квитанция живёт 2 часа: после кода при регистрации ещё анкета — имя, метро,
// резюме, фото, — и заполнять её можно не спеша.
const JT_TICKET_TTL = 7200;
const JT_AUTH_PURPOSES = ['register', 'attach', 'reset'];

/** Почта в том виде, в котором хранится, или null. */
function jt_email_norm(string $raw): ?string
{
    $e = mb_strtolower(trim($raw));
    if ($e === '' || strlen($e) > 254 || preg_match('/[\s<>\r\n]/', $e)) return null;
    return filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : null;
}

function jt_auth_code_hash(string $email, string $purpose, string $code, string $key): string
{
    return hash_hmac('sha256', $purpose . '|' . $email . '|' . $code, $key);
}

/**
 * Выпустить код и отправить письмо.
 *
 * Возвращает ['ok' => true] или ['ok' => false, 'reason' => 'wait'|'too_many'|
 * 'mail_failed', 'retry_in' => сек]. $send — функция (email, code, purpose):
 * ?string, null — отправлено.
 */
function jt_auth_issue_code(string $email, string $purpose, ?string $userId, string $key, callable $send): array
{
    $now = time();
    $recent = sb_select('jm_auth_codes', [
        'email' => 'eq.' . $email,
        'purpose' => 'eq.' . $purpose,
        'created_at' => 'gt.' . gmdate('Y-m-d\TH:i:s\Z', $now - 3600),
    ], 'id,created_at', 'created_at.desc');
    if ($recent) {
        $age = $now - (int)strtotime((string)$recent[0]['created_at']);
        if ($age < JT_CODE_RESEND) return ['ok' => false, 'reason' => 'wait', 'retry_in' => JT_CODE_RESEND - $age];
        if (count($recent) >= JT_CODE_PER_HOUR) return ['ok' => false, 'reason' => 'too_many', 'retry_in' => 3600];
    }
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $id = bin2hex(random_bytes(12));
    sb_insert('jm_auth_codes', [
        'id' => $id, 'email' => $email, 'purpose' => $purpose, 'user_id' => $userId,
        'code_hash' => jt_auth_code_hash($email, $purpose, $code, $key),
        'created_at' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $now + JT_CODE_TTL),
    ]);
    $err = $send($email, $code, $purpose);
    if ($err !== null) {
        // Письмо не ушло — код никто не получит. Строку гасим, чтобы она не
        // держала минутную паузу: человек должен мочь сразу попробовать снова.
        sb_update('jm_auth_codes', ['id' => 'eq.' . $id], ['consumed_at' => gmdate('Y-m-d\TH:i:s\Z', $now),
            'created_at' => gmdate('Y-m-d\TH:i:s\Z', $now - JT_CODE_RESEND)]);
        error_log('[auth] письмо не ушло: ' . $err);
        return ['ok' => false, 'reason' => 'mail_failed'];
    }
    return ['ok' => true];
}

/**
 * Сверить код. Проверяется только последний выпущенный: прежние после
 * повторной отправки недействительны. Возвращает ['ok' => true, 'user_id'] или
 * ['ok' => false, 'reason' => 'no_code'|'expired'|'too_many_attempts'|'wrong_code'].
 */
function jt_auth_check_code(string $email, string $purpose, string $code, string $key): array
{
    $row = sb_single('jm_auth_codes', [
        'email' => 'eq.' . $email, 'purpose' => 'eq.' . $purpose,
        'consumed_at' => 'is.null', 'order' => 'created_at.desc', 'limit' => '1',
    ]);
    if (!$row) return ['ok' => false, 'reason' => 'no_code'];
    if ((int)strtotime((string)$row['expires_at']) < time()) return ['ok' => false, 'reason' => 'expired'];
    if ((int)$row['attempts'] >= JT_CODE_ATTEMPTS) return ['ok' => false, 'reason' => 'too_many_attempts'];
    $code = preg_replace('/\D+/', '', $code);
    if (strlen($code) !== 6 || !hash_equals((string)$row['code_hash'], jt_auth_code_hash($email, $purpose, $code, $key))) {
        sb_update('jm_auth_codes', ['id' => 'eq.' . $row['id']], ['attempts' => (int)$row['attempts'] + 1]);
        $left = JT_CODE_ATTEMPTS - (int)$row['attempts'] - 1;
        return ['ok' => false, 'reason' => $left > 0 ? 'wrong_code' : 'too_many_attempts', 'left' => max(0, $left)];
    }
    sb_update('jm_auth_codes', ['id' => 'eq.' . $row['id']], ['consumed_at' => gmdate('Y-m-d\TH:i:s\Z')]);
    return ['ok' => true, 'user_id' => $row['user_id'] ?? null];
}

/** Квитанция: «почта подтверждена для цели» — подписанный сервером факт. */
function jt_auth_ticket_issue(string $email, string $purpose, ?string $uid, string $key): string
{
    $payload = rtrim(strtr(base64_encode(json_encode([
        't' => 'email', 'e' => $email, 'p' => $purpose, 'u' => $uid, 'exp' => time() + JT_TICKET_TTL,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)), '+/', '-_'), '=');
    // Своя приставка в подписи: квитанцию нельзя предъявить как токен сессии и наоборот.
    return $payload . '.' . hash_hmac('sha256', 'email-ticket|' . $payload, $key);
}

/** Проверить квитанцию под нужную цель. null — не годится. */
function jt_auth_ticket_check(string $ticket, string $purpose, string $key): ?array
{
    $parts = explode('.', trim($ticket), 2);
    if (count($parts) !== 2) return null;
    [$payload, $sig] = $parts;
    if (!hash_equals(hash_hmac('sha256', 'email-ticket|' . $payload, $key), $sig)) return null;
    $raw = base64_decode(strtr($payload, '-_', '+/'), true);
    $d = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($d) || ($d['t'] ?? '') !== 'email' || ($d['p'] ?? '') !== $purpose) return null;
    if ((int)($d['exp'] ?? 0) < time()) return null;
    $email = jt_email_norm((string)($d['e'] ?? ''));
    if ($email === null) return null;
    return ['email' => $email, 'uid' => isset($d['u']) ? (string)$d['u'] : null];
}

/** Пароль, который сервер готов принять: те же правила, что на экране. */
function jt_password_problem(string $p): ?string
{
    if (mb_strlen($p) < 8) return 'Пароль короче 8 символов';
    if (mb_strlen($p) > 128) return 'Пароль длиннее 128 символов';
    if (!preg_match('/\p{L}/u', $p) || !preg_match('/\d/', $p)) return 'В пароле нужны буквы и цифры';
    return null;
}

/** Человеческий текст причины для экрана. */
function jt_auth_reason_text(string $reason, int $retryIn = 0): string
{
    return match ($reason) {
        'wait' => "Новый код можно запросить через {$retryIn} с",
        'too_many' => 'Слишком много кодов за час. Попробуйте позже',
        'mail_failed' => 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже',
        'no_code' => 'Сначала запросите код',
        'expired' => 'Код устарел. Запросите новый',
        'too_many_attempts' => 'Слишком много неверных попыток. Запросите новый код',
        'wrong_code' => 'Неверный код',
        default => 'Не получилось. Попробуйте ещё раз',
    };
}
