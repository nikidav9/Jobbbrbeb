<?php
declare(strict_types=1);

require_once __DIR__ . '/sb_lite.php';

const JUPITER_ADMIN_PHONE = '89933431523';
const JUPITER_COOKIE = 'jt_jupiter_lab';
const JUPITER_TTL = 4 * 3600;
const JUPITER_TRY_WINDOW = 900;
const JUPITER_TRY_MAX = 10;

header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function j_b64e(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function j_b64d(string $raw): string|false {
    $pad = strlen($raw) % 4;
    if ($pad) $raw .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($raw, '-_', '+/'), true);
}

function j_session_keys(): array {
    $primary = trim((string)getenv('SESSION_SECRET'));
    $fallback = sb_lite_key();
    if ($primary === '') $primary = $fallback;
    $keys = array_filter([$primary, trim((string)getenv('SESSION_SECRET')) !== '' ? $fallback : '']);
    return array_values(array_unique($keys));
}

function j_app_claims(string $token): ?array {
    $parts = explode('.', trim($token), 2);
    if (count($parts) !== 2) return null;
    [$payload, $provided] = $parts;
    $ok = false;
    foreach (j_session_keys() as $key) {
        $expected = j_b64e(hash_hmac('sha256', $payload, $key, true));
        if (hash_equals($expected, $provided)) { $ok = true; break; }
    }
    if (!$ok) return null;
    $raw = j_b64d($payload);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data) || empty($data['uid']) || (int)($data['exp'] ?? 0) < time()) return null;
    return ['uid' => (string)$data['uid'], 'iat' => (int)($data['iat'] ?? 0)];
}

function j_admin_user(string $uid, int $iat = 0): ?array {
    try {
        $row = sb_single('jm_users', ['id' => 'eq.' . $uid], 'id,phone,is_blocked,sessions_valid_from');
    } catch (Throwable $e) {
        $row = null;
    }
    if (!is_array($row) || !empty($row['is_blocked'])) return null;
    $phone = preg_replace('/\D+/', '', (string)($row['phone'] ?? ''));
    if ($phone !== JUPITER_ADMIN_PHONE) return null;
    $validFrom = isset($row['sessions_valid_from']) && $row['sessions_valid_from'] !== null
        ? (int)strtotime((string)$row['sessions_valid_from']) : 0;
    if ($validFrom > 0 && $iat + 5 < $validFrom) return null;
    return $row;
}

function j_cookie_key(): string {
    $keys = j_session_keys();
    return $keys[0] ?? '';
}

function j_issue_cookie(string $uid): bool {
    $key = j_cookie_key();
    if ($key === '') return false;
    $payload = j_b64e(json_encode([
        'uid' => $uid,
        'iat' => time(),
        'exp' => time() + JUPITER_TTL,
        'aud' => 'jupiter-lab',
    ], JSON_UNESCAPED_SLASHES));
    $sig = j_b64e(hash_hmac('sha256', 'jupiter|' . $payload, $key, true));
    return setcookie(JUPITER_COOKIE, $payload . '.' . $sig, [
        'expires' => time() + JUPITER_TTL,
        'path' => '/jupiter/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function j_cookie_uid(): ?string {
    $token = (string)($_COOKIE[JUPITER_COOKIE] ?? '');
    $parts = explode('.', $token, 2);
    if (count($parts) !== 2) return null;
    [$payload, $provided] = $parts;
    $key = j_cookie_key();
    if ($key === '') return null;
    $expected = j_b64e(hash_hmac('sha256', 'jupiter|' . $payload, $key, true));
    if (!hash_equals($expected, $provided)) return null;
    $raw = j_b64d($payload);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data) || ($data['aud'] ?? '') !== 'jupiter-lab' || (int)($data['exp'] ?? 0) < time()) return null;
    $uid = (string)($data['uid'] ?? '');
    return $uid !== '' && j_admin_user($uid, (int)($data['iat'] ?? 0)) ? $uid : null;
}

function j_clear_cookie(): void {
    setcookie(JUPITER_COOKIE, '', [
        'expires' => time() - 3600,
        'path' => '/jupiter/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function j_try_file(): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return sys_get_temp_dir() . '/jm_try_jupiter_' . hash('sha256', $ip) . '.json';
}

function j_try_state(): array {
    $st = json_decode((string)@file_get_contents(j_try_file()), true);
    if (!is_array($st) || (int)($st['since'] ?? 0) + JUPITER_TRY_WINDOW < time()) {
        return ['since' => time(), 'fails' => 0];
    }
    return $st;
}

function j_try_blocked(): bool {
    $st = j_try_state();
    return (int)($st['fails'] ?? 0) >= JUPITER_TRY_MAX;
}

function j_try_fail(): void {
    $st = j_try_state();
    $st['fails'] = (int)($st['fails'] ?? 0) + 1;
    @file_put_contents(j_try_file(), json_encode($st), LOCK_EX);
}

function j_try_reset(): void {
    @unlink(j_try_file());
}

function j_json(array $payload, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function j_login_page(string $error = ''): never {
    http_response_code($error === '' ? 200 : 401);
    header('Content-Type: text/html; charset=utf-8');
    $safe = htmlspecialchars($error, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jupiter — вход</title><style>
    :root{font-family:Inter,system-ui,sans-serif;background:#f5f5f5;color:#171717}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}.box{width:min(430px,100%);background:#fff;border:1px solid #e5e5e5;border-radius:22px;padding:28px;box-shadow:0 14px 45px rgba(0,0,0,.07)}h1{margin:0 0 8px;font-size:30px}.muted{color:#666;line-height:1.45}.err{background:#fff1f0;color:#b42318;border-radius:10px;padding:10px 12px;margin:14px 0}label{display:block;margin-top:14px;font-size:13px;color:#555}input{width:100%;margin-top:6px;padding:12px;border:1px solid #d6d6d6;border-radius:11px;font:inherit}button{width:100%;margin-top:18px;border:0;border-radius:12px;padding:13px;background:#111;color:#fff;font-weight:800;cursor:pointer}.auto{font-size:13px;color:#777;margin-top:12px}</style></head><body><main class="box"><h1>Jupiter Private Lab</h1><p class="muted">Вход теми же телефоном и паролем, что в JobToo. Доступ разрешён только администратору.</p>'
        . ($safe !== '' ? '<div class="err">' . $safe . '</div>' : '')
        . '<form method="post" action="/jupiter-login?action=credentials"><label>Телефон<input name="phone" inputmode="tel" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Войти</button></form><p class="auto" id="auto">Проверяю активную сессию JobToo…</p></main><script>
(function(){try{var token=localStorage.getItem("jm_session_token");if(!token){for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i)||"";if(k.endsWith("jm_session_token")){token=localStorage.getItem(k);break}}}if(!token){document.getElementById("auto").textContent="Активная веб-сессия не найдена — войдите обычными данными JobToo.";return}fetch("/jupiter-login?action=session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:token})}).then(function(r){if(r.ok){location.replace("/jupiter/");return}document.getElementById("auto").textContent="Эта сессия не даёт доступ к Jupiter — войдите обычными данными JobToo."}).catch(function(){document.getElementById("auto").textContent="Автовход не сработал — войдите обычными данными JobToo."})}catch(e){document.getElementById("auto").textContent="Автовход недоступен — войдите обычными данными JobToo."}})();
</script></body></html>';
    exit;
}

$action = (string)($_GET['action'] ?? '');

if ($action === 'check') {
    if (j_cookie_uid() !== null) { http_response_code(204); exit; }
    http_response_code(401); exit;
}

if ($action === 'logout') {
    j_clear_cookie();
    header('Location: /jupiter-login', true, 302);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'session') {
    $body = json_decode((string)file_get_contents('php://input'), true);
    $token = is_array($body) ? (string)($body['token'] ?? '') : '';
    $claims = $token !== '' ? j_app_claims($token) : null;
    $user = $claims ? j_admin_user((string)$claims['uid'], (int)$claims['iat']) : null;
    if (!$user || !j_issue_cookie((string)$user['id'])) j_json(['ok' => false], 403);
    j_json(['ok' => true]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'credentials') {
    if (j_try_blocked()) j_login_page('Слишком много попыток. Попробуйте через 15 минут.');

    $phone = preg_replace('/\D+/', '', (string)($_POST['phone'] ?? ''));
    $pass = (string)($_POST['password'] ?? '');
    $row = $phone === '' ? null : sb_single('jm_users', ['phone' => 'eq.' . $phone], 'id,phone,password,is_blocked,sessions_valid_from');

    $stored = is_array($row) ? (string)($row['password'] ?? '') : '';
    $validPass = $stored !== '' && $pass !== '' && (
        str_starts_with($stored, '$2y$') || str_starts_with($stored, '$2a$') || str_starts_with($stored, '$2b$')
            ? password_verify($pass, $stored)
            : hash_equals($stored, $pass)
    );
    $admin = is_array($row) && preg_replace('/\D+/', '', (string)($row['phone'] ?? '')) === JUPITER_ADMIN_PHONE;
    if (!$validPass || !$admin || !empty($row['is_blocked'])) {
        j_try_fail();
        j_login_page('Неверный телефон или пароль.');
    }

    j_try_reset();
    if (!j_issue_cookie((string)$row['id'])) j_login_page('Сервер Jupiter пока не готов к входу.');
    header('Location: /jupiter/', true, 302);
    exit;
}

j_login_page();
