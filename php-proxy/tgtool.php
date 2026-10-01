<?php
/**
 * Служебные действия с телеграм-ботом: пост в общую группу и настройка
 * вебхука.
 *
 * Отдельным файлом, а не внутри db.php, по прозаичной причине: db.php весит
 * под сотню килобайт, и когда обычная выкладка недоступна, дописывать его
 * через API дорого. Здесь же всё нужное умещается в пару килобайт.
 *
 * Токен бота наружу не передаётся ни при каких вызовах — сервер берёт его
 * сам из app_secrets.php.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Secret');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(200); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

/** Секреты — из окружения либо из app_secrets.php рядом. Как в db.php. */
function jt_secret(string $name): string {
    static $file = null;
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);
    if ($file === null) {
        $p = __DIR__ . '/app_secrets.php';
        $v = is_readable($p) ? @include $p : null;
        $file = is_array($v) ? $v : [];
    }
    return !empty($file[$name]) ? (string)$file[$name] : '';
}

$provided = $_SERVER['HTTP_X_APP_SECRET'] ?? '';
$ok = false;
foreach ([jt_secret('APP_SECRET'), jt_secret('APP_SECRET_PREV')] as $s) {
    if ($s !== '' && hash_equals($s, $provided)) $ok = true;
}
if (!$ok) { http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit; }

$TOKEN = jt_secret('TG_BOT_TOKEN');
if ($TOKEN === '') {
    http_response_code(500);
    echo json_encode(['error' => 'TG_BOT_TOKEN не задан на сервере'], JSON_UNESCAPED_UNICODE); exit;
}

// Куда слать вебхук — только отсюда, не из запроса. Пропуск к этому файлу
// тот же, что у db.php, а он лежит в каждой сборке приложения: с адресом из
// параметра вебхук можно было бы увести.
//
// Публикации в группы (postToGroup, postToWorkGroup, createCompetitorsTopic)
// отсюда убраны 01.10.2026: пропуск достаётся из приложения кем угодно, и с
// ним в публичную группу вакансий уходил произвольный HTML. Объявления о
// вакансиях сервер собирает сам (jt_group_html), панель шлёт своим путём.
$HOOK  = getenv('TG_HOOK_URL') ?: 'https://tg.jobtoo.ru/api/tg.php';

/**
 * Ключ вебхука выводится из токена бота, а не берётся APP_SECRET: тот лежит
 * в сборке приложения, и с ним Телеграм-обновления к tg.php подделывались —
 * например, нажатие работодателя «Одобрить» под чужим telegram_id. Тот же
 * вывод — в tg.php и infra/webhook-watch.sh.
 */
function jt_tg_webhook_secret(string $token): string {
    return hash_hmac('sha256', 'jt-tg-webhook', $token);
}

function tg(string $method, array $payload = [], string $verb = 'POST'): array {
    global $TOKEN;
    $ch = curl_init('https://api.telegram.org/bot' . $TOKEN . '/' . $method);
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true];
    if ($verb === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json'];
        $opts[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // Три разных отказа требуют трёх разных действий. Если curl_exec вернул
    // false, Telegram запрос вообще не видел. Строка без JSON означает, что
    // ответ пришёл, но мы его не поняли. И только корректный JSON с ok=false
    // является отказом самого Telegram.
    if ($resp === false) {
        return [
            'ok' => false,
            'error_kind' => 'transport',
            'curl_error' => $curlError,
            'curl_errno' => $curlErrno,
            'http_code' => $httpCode,
        ];
    }
    $dec = json_decode($resp, true);
    if (!is_array($dec)) {
        return [
            'ok' => false,
            'error_kind' => 'invalid_response',
            'json_error' => json_last_error_msg(),
            'http_code' => $httpCode,
            'raw' => substr($resp, 0, 500),
        ];
    }
    if (($dec['ok'] ?? false) !== true) {
        $dec['error_kind'] = 'telegram';
        $dec['http_code'] = $httpCode;
    }
    return $dec;
}

$body   = json_decode((string)file_get_contents('php://input'), true);
$action = is_array($body) ? (string)($body['action'] ?? '') : '';

switch ($action) {
    // Нужно после смены токена: вебхук привязан к боту, но переставить его
    // может только тот, у кого есть действующий токен.
    case 'setWebhook': {
        $res = tg('setWebhook', [
            'url' => $HOOK,
            'secret_token' => jt_tg_webhook_secret($TOKEN),
            'allowed_updates' => ['message', 'callback_query'],
        ]);
        echo json_encode(['target' => $HOOK, 'telegram' => $res], JSON_UNESCAPED_UNICODE);
        break;
    }

    case 'webhookInfo':
        echo json_encode(tg('getWebhookInfo', [], 'GET'), JSON_UNESCAPED_UNICODE);
        break;

    case 'me':
        echo json_encode(tg('getMe', [], 'GET'), JSON_UNESCAPED_UNICODE);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Неизвестное действие: ' . $action], JSON_UNESCAPED_UNICODE);
}
