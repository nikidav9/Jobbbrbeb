<?php
// Прокси для админ-дашборда.
//
// Зачем: дашборд ходил в базу напрямую публичным ключом, а «вход по паролю»
// был флажком в localStorage — сервер его не проверял. То есть данные лежали
// открыто для любого, кто знает адрес Supabase, а вход ничего не защищал.
//
// Теперь так: дашборд стучится сюда, здесь проверяется токен, и только после
// этого запрос уходит в Supabase под сервисным ключом. Ключ остаётся на
// сервере. Токен выдаётся в обмен на логин и пароль — те же, что и раньше.
//
// Пропускаем только чтение и запись таблиц jm_* и вызов функции рассылки
// push-notify. Ни служебные схемы, ни auth, ни storage через эту дверь
// не достать.

// Адрес бэкенда — из секрета, как и ключ рядом.
//
// Так переключение между облаком и своим сервером (и откат обратно) — это
// смена одного значения в настройках, а не правка трёх файлов и выкладка.
// Откат важнее: если после переезда что-то пойдёт не так, вернуться надо
// быстро, а не собирать релиз.
//
// Значение не задано — работает облако. Выкладка сама по себе ничего не
// переключает, и это намеренно.
// Адрес бэкенда — свой сервер в Москве, и только он.
//
// Раньше здесь была пара «переменная окружения SB_URL или файл sb_url.php, а
// иначе умолчание». Заводилось это как быстрый откат в облако, если переезд
// пойдёт не так. Переезд состоялся 15.08, данные давно в России, а рычаг
// остался — и это ровно тот рычаг, которым первичная запись ПДн граждан РФ
// одной настройкой уводится за границу, мимо ч. 5 ст. 18 152-ФЗ.
//
// Поэтому адрес теперь в коде. Сменить его — правка и коммит, и это осознанно:
// так переезд виден в истории, а не случается от значения в чужом окружении.
define('SB_URL', 'https://jobtoo.ru');

// Ключ — та же схема, что в db.php: сервисный с хостинга, анонимный как
// запасной вариант. Подробности там же.

function sb_resolve_key(): string {
    $env = getenv('SB_SERVICE_KEY');
    if (is_string($env) && trim($env) !== '') return trim($env);

    $file = __DIR__ . '/sb_service_key.php';
    if (is_readable($file)) {
        $v = @include $file;
        if (is_string($v) && trim($v) !== '') return trim($v);
    }

    // Запасного ключа в коде больше нет. Прежний анонимный лежал здесь на
    // случай «чтобы ничего не легло» — но он же пережил бы смену ключей и
    // работал бы дальше втихую. Пусто — значит запросы честно упадут, и это
    // видно сразу, а не через месяц.
    return '';
}

define('SB_KEY', sb_resolve_key());

// ── Учётные данные админа ────────────────────────────────────────────────
// Из переменных окружения либо из файла admin_credentials.php рядом
// (см. admin_credentials.example.php).
function admin_credentials(): array {
    $login = getenv('DASHBOARD_LOGIN');
    $pwd   = getenv('DASHBOARD_PASSWORD');
    if (is_string($login) && $login !== '' && is_string($pwd) && $pwd !== '') {
        return ['login' => $login, 'password' => $pwd];
    }

    $file = __DIR__ . '/admin_credentials.php';
    if (is_readable($file)) {
        $v = @include $file;
        if (is_array($v) && !empty($v['login']) && !empty($v['password'])) {
            return ['login' => (string)$v['login'], 'password' => (string)$v['password']];
        }
    }

    return [];
}

// ── CORS ─────────────────────────────────────────────────────────────────
// Дашборд живёт на другом домене, поэтому браузер сначала шлёт preflight.
// Токен передаём заголовком, а не куками, поэтому Allow-Credentials не нужен
// и звёздочки достаточно.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token, Prefer, Range, Range-Unit, Accept, apikey, Authorization, X-Client-Info, Accept-Profile, Content-Profile');
// Content-Range нужен для .select(count) — без него дашборд не увидит счётчики.
header('Access-Control-Expose-Headers: Content-Range');
header('Access-Control-Max-Age: 86400');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function fail(int $code, string $msg): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Токен ────────────────────────────────────────────────────────────────
// Подписываем срок годности ключом, который выводится из сервисного ключа и
// пароля. Меняется пароль — все выданные токены разом становятся негодными.
define('TOKEN_TTL', 12 * 3600);

function token_secret(string $password): string {
    return hash('sha256', SB_KEY . '|' . $password);
}

function token_issue(string $password): string {
    $payload = 'v1.' . (time() + TOKEN_TTL);
    return $payload . '.' . hash_hmac('sha256', $payload, token_secret($password));
}

function token_valid(string $token, string $password): bool {
    $parts = explode('.', $token);
    if (count($parts) !== 3 || $parts[0] !== 'v1') return false;
    $payload = $parts[0] . '.' . $parts[1];
    if (!hash_equals(hash_hmac('sha256', $payload, token_secret($password)), $parts[2])) return false;
    return (int)$parts[1] > time();
}

// ── Ограничение попыток входа ────────────────────────────────────────────
// Пароль — единственная преграда, поэтому перебор надо гасить. Считаем
// неудачи по IP: десять за четверть часа — и дверь закрывается на это время.
define('LOGIN_MAX_FAILS', 10);
define('LOGIN_WINDOW', 900);

function throttle_file(): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return sys_get_temp_dir() . '/jm_admin_login_' . hash('sha256', $ip) . '.json';
}

function throttle_blocked(): bool {
    $f = throttle_file();
    if (!is_readable($f)) return false;
    $st = json_decode((string)@file_get_contents($f), true);
    if (!is_array($st)) return false;
    if (($st['since'] ?? 0) + LOGIN_WINDOW < time()) return false;
    return ($st['fails'] ?? 0) >= LOGIN_MAX_FAILS;
}

function throttle_note_failure(): void {
    $f = throttle_file();
    $st = is_readable($f) ? json_decode((string)@file_get_contents($f), true) : null;
    if (!is_array($st) || ($st['since'] ?? 0) + LOGIN_WINDOW < time()) {
        $st = ['since' => time(), 'fails' => 0];
    }
    $st['fails'] = ($st['fails'] ?? 0) + 1;
    @file_put_contents($f, json_encode($st), LOCK_EX);
}

function throttle_reset(): void { @unlink(throttle_file()); }

$creds = admin_credentials();
if (!$creds) fail(500, 'Admin credentials are not configured on the server');

// ── Вход ─────────────────────────────────────────────────────────────────
if (($_GET['action'] ?? '') === 'login') {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'Method not allowed');
    if (throttle_blocked()) fail(429, 'Слишком много попыток. Попробуйте через 15 минут.');

    $body = json_decode((string)file_get_contents('php://input'), true);
    $login = (string)($body['login'] ?? '');
    $pwd   = (string)($body['password'] ?? '');

    // hash_equals, а не ==, чтобы по времени ответа нельзя было подбирать
    // пароль посимвольно.
    $ok = hash_equals($creds['login'], $login) && hash_equals($creds['password'], $pwd);
    if (!$ok) {
        throttle_note_failure();
        fail(401, 'Неверный логин или пароль');
    }

    throttle_reset();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['token' => token_issue($creds['password']), 'expiresIn' => TOKEN_TTL]);
    exit;
}

// ── Всё остальное — сквозной запрос к базе ───────────────────────────────
$token = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
if (!is_string($token) || $token === '' || !token_valid($token, $creds['password'])) {
    fail(401, 'Not authorized');
}

// ── История доступности сайта ────────────────────────────────────────────────
// Раздел «Доступность» в дашборде. Отдаём поминутную историю здоровья, которую
// пишет health-sample.sh. Через эту дверь, а не файлом с nginx: сам файл на всех
// vhost намеренно закрыт (return 404) — в нём внутренняя телеметрия, и открывать
// её всем незачем. Здесь она за тем же токеном, что и остальная админка.
//
// Файл лежит рядом с кодом прокси: контейнер php читает только свой каталог
// (/var/www/api) и до /var/www/html не дотягивается, поэтому health-sample.sh
// кладёт копию сюда же. Отдаём как есть — разбор на стороне дашборда.
if (($_GET['action'] ?? '') === 'health') {
    $f = __DIR__ . '/health-history.ndjson';
    header('Content-Type: application/x-ndjson; charset=utf-8');
    header('Cache-Control: no-store');
    if (is_readable($f)) {
        readfile($f);
    }
    exit;
}

$path = (string)($_GET['path'] ?? '');
// Только таблицы приложения и одна функция рассылки. Ни auth, ни storage,
// ни служебные схемы.
//
// push-notify здесь потому, что рассылки в дашборде перестали работать, когда
// мы убрали из браузера сервисный ключ: страница зовёт эту функцию, а под
// правило «/rest/v1/jm_*» её адрес не подходит и не подойдёт никогда. Пускаем
// именно её по имени, а не весь /functions/v1 — чтобы через дашборд нельзя
// было запустить что угодно.
// jm_delete_account — по имени, а не «весь /rpc». Она обезличивает аккаунт
// и стирает его личные записи; отдать через эту дверь любую хранимую функцию
// значило бы отдать всё, что когда-нибудь появится в базе.
$allowed = preg_match('#^/rest/v1/jm_[a-z0-9_]+(\?|$)#', $path)
        || preg_match('#^/rest/v1/rpc/jm_delete_account(\?|$)#', $path)
        || preg_match('#^/functions/v1/push-notify(\?|$)#', $path);
if (!$allowed) {
    fail(400, 'Path not allowed: ' . $path);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], true)) fail(405, 'Method not allowed');

// ── Рассылка ─────────────────────────────────────────────────────────────────
// Раньше её делала облачная функция push-notify, и сюда запрос просто
// пересылался. На своём сервере функций нет вовсе: их движок не поднимали,
// а единственную функцию решили переписать. Пока это не было сделано, кнопка
// рассылки в дашборде отвечала 404 — и никто бы не узнал почему.
//
// Логика повторяет прежнюю дословно, включая её главную осторожность:
// без userId и без target запрос отвергается. Однажды такой запрос молча
// ушёл всем, у кого есть токен, и 96 человек получили слово «проверка».
if (preg_match('#^/functions/v1/push-notify(\?|$)#', $path)) {
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $userId = (string)($in['userId'] ?? '');
    $target = (string)($in['target'] ?? '');
    $title  = (string)($in['title'] ?? '');
    $body   = (string)($in['body'] ?? '');
    $metro  = (string)($in['metro'] ?? '');
    $mode   = (string)($in['mode'] ?? 'push');   // push | inapp | both

    if ($userId === '' && $target === '') {
        fail(400, 'Нужен userId или target (all / workers / employers / metro)');
    }

    // Кого оповещаем.
    $q = ['select' => 'id,push_token'];
    if ($userId !== '') {
        $q['id'] = 'eq.' . $userId;
    } else {
        if ($target === 'workers')   $q['role'] = 'eq.worker';
        if ($target === 'employers') $q['role'] = 'eq.employer';
        if ($target === 'metro' && $metro !== '') $q['metro_station'] = 'eq.' . $metro;
        // Для чистого пуша берём только тех, кому есть куда его слать.
        // Колокольчику токен не нужен — там нужны все.
        if ($mode === 'push') $q['push_token'] = 'not.is.null';
    }

    $ch = curl_init(SB_URL . '/rest/v1/jm_users?' . http_build_query($q));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY],
        CURLOPT_TIMEOUT => 30,
    ]);
    $rows = json_decode((string)curl_exec($ch), true);
    curl_close($ch);
    if (!is_array($rows) || !$rows) fail(400, 'Нет подходящих пользователей');

    $ids    = array_values(array_filter(array_map(fn($u) => (string)($u['id'] ?? ''), $rows)));
    $tokens = array_values(array_filter(array_map(fn($u) => (string)($u['push_token'] ?? ''), $rows)));

    $pushCount = 0;
    if ($tokens && $mode !== 'inapp') {
        foreach (array_chunk($tokens, 100) as $chunk) {
            $msgs = array_map(fn($to) => [
                'to' => $to, 'title' => $title, 'body' => $body,
                'sound' => 'default', 'channelId' => 'default', 'priority' => 'high',
                'data' => ['type' => 'broadcast'],
            ], $chunk);
            $c = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($c, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_POSTFIELDS => json_encode(count($msgs) === 1 ? $msgs[0] : $msgs),
                CURLOPT_TIMEOUT => 20,
            ]);
            curl_exec($c); curl_close($c);
            $pushCount += count($chunk);
        }
    }

    $inappCount = 0;
    if ($ids && ($mode === 'inapp' || $mode === 'both')) {
        foreach (array_chunk($ids, 500) as $chunk) {
            // id и время задаём сами: облачная функция полагалась на значения
            // по умолчанию, а они уже однажды потерялись при переносе схемы.
            $now = gmdate('Y-m-d\TH:i:s\Z');
            $payload = array_map(fn($uid) => [
                'id' => bin2hex(random_bytes(12)),
                'user_id' => $uid, 'title' => $title, 'body' => $body,
                'is_read' => false, 'created_at' => $now,
            ], $chunk);
            $c = curl_init(SB_URL . '/rest/v1/jm_notifications');
            curl_setopt_array($c, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY,
                    'Content-Type: application/json', 'Prefer: return=minimal',
                ],
                CURLOPT_POSTFIELDS => json_encode($payload),
                CURLOPT_TIMEOUT => 30,
            ]);
            curl_exec($c);
            $code = (int)curl_getinfo($c, CURLINFO_HTTP_CODE);
            curl_close($c);
            if ($code >= 200 && $code < 300) $inappCount += count($chunk);
        }
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['pushCount' => $pushCount, 'inappCount' => $inappCount], JSON_UNESCAPED_UNICODE);
    exit;
}

$hdrs = [
    'apikey: ' . SB_KEY,
    'Authorization: Bearer ' . SB_KEY,
];
// Заголовки, на которых держится PostgREST: Prefer управляет upsert и
// возвратом строк, Range — постраничностью и подсчётом.
foreach ([
    'HTTP_PREFER'       => 'Prefer',
    'HTTP_RANGE'        => 'Range',
    'HTTP_RANGE_UNIT'   => 'Range-Unit',
    'HTTP_ACCEPT'       => 'Accept',
    'CONTENT_TYPE'      => 'Content-Type',
] as $srv => $name) {
    if (!empty($_SERVER[$srv])) $hdrs[] = $name . ': ' . $_SERVER[$srv];
}

$ch = curl_init(SB_URL . $path);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $hdrs,
    CURLOPT_HEADER         => true,
    CURLOPT_TIMEOUT        => 30,
]);
if (in_array($method, ['POST', 'PATCH', 'PUT'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, (string)file_get_contents('php://input'));
}

$raw = curl_exec($ch);
if ($raw === false) {
    $err = curl_error($ch);
    curl_close($ch);
    fail(502, 'Upstream error: ' . $err);
}
$status  = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hdrSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

$rawHeaders = substr($raw, 0, $hdrSize);
$body       = substr($raw, $hdrSize);

http_response_code($status);
// Пробрасываем обратно только то, что нужно клиенту. Всё остальное (в том
// числе всё, что могло бы намекнуть на ключ) отбрасываем.
foreach (explode("\r\n", $rawHeaders) as $line) {
    $p = strpos($line, ':');
    if ($p === false) continue;
    $name = strtolower(trim(substr($line, 0, $p)));
    if ($name === 'content-range' || $name === 'content-type') {
        header(trim(substr($line, 0, $p)) . ':' . substr($line, $p + 1));
    }
}
echo $body;
