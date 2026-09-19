<?php
// One-time authenticated Web Push probe. The repository contains only the
// SHA-256 of the random probe token; the phone number is supplied over HTTPS
// at invocation time and is never committed.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(int $code, array $body): never {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$input = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($input)) out(400, ['ok' => false, 'error' => 'bad_json']);

$token = (string)($input['token'] ?? '');
$phone = preg_replace('/\D+/', '', (string)($input['phone'] ?? ''));
$expected = '966c0ce4e9529b7b9c617054b5eb7ef504992e2293f96a4954b964f922fe36f5';

if ($token === '' || !hash_equals($expected, hash('sha256', $token))) {
    out(403, ['ok' => false, 'error' => 'forbidden']);
}
if (!is_string($phone) || strlen($phone) !== 11) {
    out(400, ['ok' => false, 'error' => 'bad_phone']);
}

$serviceFile = __DIR__ . '/sb_service_key.php';
$serviceKey = is_readable($serviceFile) ? @include $serviceFile : '';
if (!is_string($serviceKey) || $serviceKey === '') {
    out(500, ['ok' => false, 'error' => 'service_key_missing']);
}

$appFile = __DIR__ . '/app_secrets.php';
$appSecrets = is_readable($appFile) ? @include $appFile : [];
$appSecret = is_array($appSecrets) ? (string)($appSecrets['APP_SECRET'] ?? '') : '';
if ($appSecret === '') {
    out(500, ['ok' => false, 'error' => 'app_secret_missing']);
}

function rest_get(string $path, array $query, string $key): array {
    $url = 'http://127.0.0.1:3000/' . $path . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Accept: application/json',
        ],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $status >= 400) {
        throw new RuntimeException('rest_failed:' . $status . ':' . $err);
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function dashboard_push(int $port, string $secret, array $subscription): array {
    $payload = json_encode([
        'subscription' => $subscription,
        'title' => 'JobToo',
        'body' => 'Тестовое уведомление JobToo',
        'data' => ['type' => 'test'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $ch = curl_init('http://127.0.0.1:' . $port . '/api/webpush/send');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-app-secret: ' . $secret,
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 15,
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = json_decode(is_string($raw) ? $raw : '', true);
    return [
        'ok' => $status >= 200 && $status < 300 && is_array($decoded) && !empty($decoded['ok']),
        'status' => $status,
        'error' => is_array($decoded) ? (string)($decoded['error'] ?? '') : $err,
    ];
}

$candidates = [$phone];
if ($phone[0] === '8') {
    $candidates[] = '7' . substr($phone, 1);
} elseif ($phone[0] === '7') {
    $candidates[] = '8' . substr($phone, 1);
}
$candidates = array_values(array_unique($candidates));

$user = null;
foreach ($candidates as $candidate) {
    $rows = rest_get('jm_users', [
        'select' => 'id',
        'phone' => 'eq.' . $candidate,
        'limit' => '1',
    ], $serviceKey);
    if (!empty($rows[0]['id'])) {
        $user = $rows[0];
        break;
    }
}
if (!$user) out(404, ['ok' => false, 'error' => 'user_not_found']);

$subs = rest_get('jm_web_push_subscriptions', [
    'select' => 'endpoint,p256dh,auth',
    'user_id' => 'eq.' . (string)$user['id'],
    'order' => 'updated_at.desc',
    'limit' => '1',
], $serviceKey);
if (empty($subs[0]['endpoint']) || empty($subs[0]['p256dh']) || empty($subs[0]['auth'])) {
    out(404, ['ok' => false, 'error' => 'webpush_subscription_not_found']);
}

$subscription = [
    'endpoint' => (string)$subs[0]['endpoint'],
    'keys' => [
        'p256dh' => (string)$subs[0]['p256dh'],
        'auth' => (string)$subs[0]['auth'],
    ],
];

$attempts = [];
foreach ([3002, 3003] as $port) {
    $result = dashboard_push($port, $appSecret, $subscription);
    $attempts[] = ['port' => $port, 'status' => $result['status'], 'error' => $result['error']];
    if ($result['ok']) {
        @unlink(__FILE__);
        out(200, ['ok' => true, 'sent' => true]);
    }
}

out(502, ['ok' => false, 'error' => 'push_send_failed', 'attempts' => $attempts]);
