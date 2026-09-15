<?php
// Принимает подписанные изменения статуса отклика от партнёра.

@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/partner_core.php';

$sourceId = trim((string)($_GET['source'] ?? ''));
$timestamp = (string)($_SERVER['HTTP_X_PARTNER_TIMESTAMP'] ?? '');
$signature = (string)($_SERVER['HTTP_X_PARTNER_SIGNATURE'] ?? '');
$raw = (string)file_get_contents('php://input');
$source = $sourceId !== '' ? sb_single('jm_ext_sources', [
    'id' => 'eq.' . $sourceId, 'enabled' => 'is.true', 'environment' => 'eq.production',
    'integration_mode' => 'eq.embedded',
], 'id,webhook_secret') : null;
if (!$source || !pg_verify_webhook((string)($source['webhook_secret'] ?? ''), $timestamp, $raw, $signature)) {
    http_response_code(401); echo json_encode(['error' => 'Invalid signature']); exit;
}
$event = json_decode($raw, true);
$eventId = trim((string)($event['event_id'] ?? ''));
$applicationId = trim((string)($event['application_id'] ?? ''));
$status = trim((string)($event['status'] ?? ''));
$version = (int)($event['status_version'] ?? 0);
if ($eventId === '' || $applicationId === '' || $status === '' || $version < 1) {
    http_response_code(400); echo json_encode(['error' => 'Invalid event']); exit;
}
$claimRows = sb_rpc('jm_claim_partner_inbox', [
    'p_id' => bin2hex(random_bytes(12)),
    'p_source_id' => $sourceId,
    'p_partner_event_id' => $eventId,
    'p_event_kind' => 'application.status',
    'p_payload' => $event,
]);
$claim = $claimRows[0] ?? null;
if (!is_array($claim)) {
    http_response_code(503); echo json_encode(['error' => 'Inbox unavailable']); exit;
}
$inboxId = (string)($claim['inbox_id'] ?? '');
$claimStatus = (string)($claim['claim_status'] ?? '');
if ($claimStatus === 'duplicate') {
    echo json_encode(['ok' => true, 'duplicate' => true]); exit;
}
if ($claimStatus === 'busy') {
    http_response_code(202); echo json_encode(['ok' => true, 'processing' => true]); exit;
}
if ($claimStatus === 'conflict') {
    http_response_code(409); echo json_encode(['error' => 'Event id reused with different payload']); exit;
}
if ($claimStatus !== 'claimed' || $inboxId === '') {
    http_response_code(503); echo json_encode(['error' => 'Inbox claim failed']); exit;
}

try {
    $transition = null;
    $applied = false;

    // Разные event_id одной заявки тоже могут прийти параллельно. Inbox-claim
    // защищает только от дубля ОДНОГО события, но не от lost update между
    // accepted/booked/checked_in. Поэтому запись статуса — optimistic CAS:
    // обновляем только ту status/version, которую только что прочитали.
    for ($casAttempt = 0; $casAttempt < 4; $casAttempt++) {
        $application = sb_single('jm_partner_applications', [
            'source_id' => 'eq.' . $sourceId,
            'or' => '(id.eq.' . $applicationId . ',partner_application_id.eq.' . $applicationId . ')',
        ], '*');
        if (!$application) throw new RuntimeException('Application not found');

        $transition = pg_transition($application, $status, $version,
            isset($event['updated_at']) ? (string)$event['updated_at'] : null);
        if (empty($transition['applied'])) {
            if (($transition['reason'] ?? '') === 'invalid_transition') {
                // Более поздний статус мог обогнать промежуточный callback.
                // Не помечаем его обработанным: после 409 партнёр может
                // повторить событие, а lease inbox уже будет освобождён.
                throw new DomainException('Out-of-order partner status');
            }
            // stale — состояние в БД уже новее; такой callback действительно
            // можно завершить как идемпотентный no-op.
            break;
        }

        $next = $transition['application'];
        $changed = sb_update_returning('jm_partner_applications', [
            'id' => 'eq.' . $application['id'],
            'status' => 'eq.' . (string)$application['status'],
            'status_version' => 'eq.' . (int)$application['status_version'],
        ], [
            'status' => $next['status'], 'status_version' => $next['status_version'],
            'updated_at' => $next['updated_at'],
            'partner_updated_at' => $next['partner_updated_at'] ?? null,
            'failure_code' => null, 'failure_message' => null,
        ]);
        if ($changed) {
            $applied = true;
            break;
        }
        // CAS проигран — перечитываем строку и решаем тот же event заново уже
        // относительно победившего состояния. Никаких слепых перезаписей.
    }

    if (!empty($transition['applied']) && !$applied) {
        throw new RuntimeException('Concurrent partner status contention');
    }

    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processed_at' => now_iso(), 'processing_started_at' => null, 'processing_error' => null,
    ]);
    echo json_encode(['ok' => true, 'applied' => $applied,
        'reason' => $transition['reason'] ?? null]);
} catch (DomainException $e) {
    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processing_started_at' => null,
        'processing_error' => substr($e->getMessage(), 0, 500),
    ]);
    http_response_code(409); echo json_encode(['error' => 'Event is out of order']);
} catch (Throwable $e) {
    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processing_started_at' => null,
        'processing_error' => substr($e->getMessage(), 0, 500),
    ]);
    $retryable = str_starts_with($e->getMessage(), 'Database request failed')
        || $e->getMessage() === 'Concurrent partner status contention';
    http_response_code($retryable ? 503 : 422);
    echo json_encode(['error' => $retryable ? 'Temporary processing failure' : 'Event was not applied']);
}
