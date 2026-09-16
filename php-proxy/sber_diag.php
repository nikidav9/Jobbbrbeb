<?php
// ВРЕМЕННАЯ диагностика исходящего соединения московского backend с Sber.
// Доступ только через тот же закрытый deploy-token, что и deploy.php.
// После локализации сетевого расхождения файл должен быть удалён.

@ini_set('display_errors', '0');
@set_time_limit(60);
header('Content-Type: application/json; charset=utf-8');

function diag_out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$tokenFile = __DIR__ . '/deploy_token.php';
$token = is_readable($tokenFile) ? (string) @include $tokenFile : '';
$given = $_SERVER['HTTP_X_DEPLOY_TOKEN'] ?? '';
if ($token === '' || !is_string($given) || $given === '' || !hash_equals($token, $given)) {
    diag_out(403, ['ok' => false, 'error' => 'нет доступа']);
}

$host = 'rabota.sber.ru';
$path = '/public/app-candidate-public-api-gateway/api/v1/publications?take=1&skip=0';
$url = 'https://' . $host . $path;

$ips = [];
$records = @dns_get_record($host, DNS_A | DNS_AAAA);
if (is_array($records)) {
    foreach ($records as $record) {
        $ip = (string)($record['ip'] ?? $record['ipv6'] ?? '');
        if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) $ips[$ip] = true;
    }
}
if (!$ips) {
    foreach ((array)@gethostbynamel($host) as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP)) $ips[$ip] = true;
    }
}
$ips = array_keys($ips);

function sber_probe(string $url, string $host, ?string $ip, string $ua): array
{
    $body = '';
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT => $ua,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body): int {
            if (strlen($body) < 262144) $body .= substr($chunk, 0, 262144 - strlen($body));
            return strlen($chunk);
        },
    ];
    if ($ip !== null) {
        $literal = str_contains($ip, ':') ? '[' . $ip . ']' : $ip;
        $opts[CURLOPT_RESOLVE] = [$host . ':443:' . $literal];
    }
    curl_setopt_array($ch, $opts);
    $exec = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $primary = (string)curl_getinfo($ch, CURLINFO_PRIMARY_IP);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $httpVersion = (int)curl_getinfo($ch, CURLINFO_HTTP_VERSION);
    $sslVerify = (int)curl_getinfo($ch, CURLINFO_SSL_VERIFYRESULT);
    $totalTime = (float)curl_getinfo($ch, CURLINFO_TOTAL_TIME);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    curl_close($ch);

    $decoded = json_decode($body, true);
    return [
        'pinned_ip' => $ip,
        'primary_ip' => $primary,
        'http_code' => $code,
        'curl_ok' => $exec !== false,
        'curl_errno' => $errno,
        'curl_error' => $error,
        'content_type' => $contentType,
        'http_version' => $httpVersion,
        'ssl_verify_result' => $sslVerify,
        'total_time' => $totalTime,
        'json_ok' => is_array($decoded),
        'success' => is_array($decoded) ? ($decoded['success'] ?? null) : null,
        'total' => is_array($decoded) ? ($decoded['data']['total'] ?? null) : null,
        'first_internal_id' => is_array($decoded) ? ($decoded['data']['vacancies'][0]['internalId'] ?? null) : null,
        'body_prefix' => substr(preg_replace('/\s+/', ' ', $body) ?? '', 0, 180),
    ];
}

$jobtooUa = 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)';
$browserUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';

$probes = [
    ['mode' => 'dns-default-jobtoo', 'result' => sber_probe($url, $host, null, $jobtooUa)],
    ['mode' => 'dns-default-browser', 'result' => sber_probe($url, $host, null, $browserUa)],
];
foreach (array_slice($ips, 0, 8) as $ip) {
    $probes[] = ['mode' => 'pinned-jobtoo', 'result' => sber_probe($url, $host, $ip, $jobtooUa)];
    $probes[] = ['mode' => 'pinned-browser', 'result' => sber_probe($url, $host, $ip, $browserUa)];
}

diag_out(200, [
    'ok' => true,
    'host' => $host,
    'path' => $path,
    'dns_ips' => $ips,
    'php' => PHP_VERSION,
    'curl_version' => curl_version()['version'] ?? '',
    'probes' => $probes,
]);
