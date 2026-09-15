<?php
// Доставляет поставленные в очередь отклики подключённым партнёрам.
// Запускается cron тем же закрытым токеном, что и сборщик вакансий.

@ini_set('display_errors', '0');
@set_time_limit(120);
header('Content-Type: application/json; charset=utf-8');
define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/partner_core.php';

function po_secret(string $name): string {
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);
    $file = __DIR__ . '/app_secrets.php';
    $values = is_readable($file) ? @include $file : null;
    return is_array($values) ? (string)($values[$name] ?? '') : '';
}

$expected = po_secret('ADMIN_API_TOKEN');
if ($expected === '') {
    $credentials = is_readable(__DIR__ . '/admin_credentials.php')
        ? @include __DIR__ . '/admin_credentials.php' : null;
    $expected = is_array($credentials) ? (string)($credentials['password'] ?? '') : '';
}
$provided = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
if ($expected === '' || !hash_equals($expected, $provided)) {
    http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
}

function po_send(string $url, array $headers, array $body): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($error !== '' || $code < 200 || $code >= 300) {
        throw new RuntimeException($error !== '' ? $error : 'Partner HTTP ' . $code);
    }
    $decoded = json_decode((string)$response, true);
    return is_array($decoded) ? $decoded : [];
}

$delivered = 0; $failed = 0; $dead = 0; $selected = 0;
// Не резервируем пачку на минуты вперёд: если партнёр тормозит, процесс может
// закончиться по лимиту времени и оставить ещё не начатые события в sending.
// Берём одно событие атомарно прямо перед отправкой. Параллельные cron-воркеры
// получают разные события благодаря FOR UPDATE SKIP LOCKED в RPC.
$deadline = microtime(true) + 95;
while ($selected < 50 && microtime(true) < $deadline) {
    $claimed = sb_rpc('jm_claim_partner_outbox', ['p_limit' => 1]);
    $event = $claimed[0] ?? null;
    if (!is_array($event)) break;
    $selected++;
    $attempt = (int)($event['attempts'] ?? 0) + 1;
    try {
        if (($event['event_kind'] ?? '') !== 'application.submit')
            throw new RuntimeException('Unsupported event kind');
        $source = sb_single('jm_ext_sources', [
            'id' => 'eq.' . $event['source_id'], 'enabled' => 'is.true',
            'environment' => 'eq.production', 'integration_mode' => 'eq.embedded',
        ], 'id,name,connector_config,auth_header,auth_value');
        $config = is_array($source['connector_config'] ?? null) ? $source['connector_config'] : [];
        $endpoint = trim((string)($config['application_submit_url'] ?? ''));
        if (!$source || $endpoint === '') throw new RuntimeException('Partner submit endpoint is not configured');

        $application = sb_single('jm_partner_applications', ['id' => 'eq.' . $event['aggregate_id']], '*');
        $vacancy = $application ? sb_single('jm_ext_vacancies', [
            'id' => 'eq.' . $application['ext_vacancy_id'],
            'source_id' => 'eq.' . $application['source_id'],
        ], 'external_id,title') : null;
        $worker = $application ? sb_single('jm_users', ['id' => 'eq.' . $application['worker_id']],
            'id,first_name,last_name,phone,work_types,bio') : null;
        $consent = $application ? sb_single('jm_partner_data_consents', [
            'application_id' => 'eq.' . $application['id'], 'revoked_at' => 'is.null',
        ], 'id,consent_version') : null;
        if (!$application || !$vacancy || !$worker || !$consent)
            throw new RuntimeException('Application data or active consent is missing');

        sb_update('jm_partner_applications', ['id' => 'eq.' . $application['id']], [
            'status' => 'submitting', 'updated_at' => now_iso(),
            'failure_code' => null, 'failure_message' => null,
        ]);
        $headers = ['Idempotency-Key: ' . $event['idempotency_key']];
        $authHeader = trim((string)($source['auth_header'] ?? ''));
        if ($authHeader !== '') $headers[] = $authHeader . ': ' . (string)($source['auth_value'] ?? '');
        $reply = po_send($endpoint, $headers, [
            'application_id' => $application['id'],
            'vacancy_id' => $vacancy['external_id'],
            'vacancy_title' => $vacancy['title'],
            'worker' => [
                'id' => $worker['id'], 'first_name' => $worker['first_name'],
                'last_name' => $worker['last_name'], 'phone' => $worker['phone'],
                'work_types' => $worker['work_types'] ?? [], 'bio' => $worker['bio'] ?? null,
            ],
            'consent_version' => $consent['consent_version'],
        ]);
        sb_update('jm_partner_applications', ['id' => 'eq.' . $application['id']], [
            'status' => 'submitted', 'partner_application_id' => $reply['application_id'] ?? null,
            'updated_at' => now_iso(),
        ]);
        sb_update('jm_partner_outbox', ['id' => 'eq.' . $event['id']], [
            'delivery_status' => 'delivered', 'attempts' => $attempt,
            'delivered_at' => now_iso(), 'locked_at' => null, 'last_error' => null,
        ]);
        $delivered++;
    } catch (Throwable $e) {
        $isDead = $attempt >= 8;
        sb_update('jm_partner_outbox', ['id' => 'eq.' . $event['id']], [
            'delivery_status' => $isDead ? 'dead' : 'failed', 'attempts' => $attempt,
            'next_attempt_at' => gmdate('Y-m-d\TH:i:s\Z', time() + pg_retry_delay_seconds($attempt)),
            'locked_at' => null, 'last_error' => substr($e->getMessage(), 0, 500),
        ]);
        sb_update('jm_partner_applications', ['id' => 'eq.' . $event['aggregate_id']], [
            'status' => 'failed', 'updated_at' => now_iso(),
            'failure_code' => $isDead ? 'delivery_dead' : 'delivery_retry',
            'failure_message' => substr($e->getMessage(), 0, 500),
        ]);
        $isDead ? $dead++ : $failed++;
    }
}

echo json_encode(['ok' => true, 'selected' => $selected, 'delivered' => $delivered,
    'retrying' => $failed, 'dead' => $dead], JSON_UNESCAPED_UNICODE);
