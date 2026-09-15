from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'php-proxy/sb_lite.php',
    """    function sb_update(string $t, array $f, array $data): void
    {
        sb('PATCH', $t, $f, $data, ['Prefer: return=minimal']);
    }

    /** Вставить или обновить по ключу конфликта — одним запросом на пачку. */
""",
    """    function sb_update(string $t, array $f, array $data): void
    {
        sb('PATCH', $t, $f, $data, ['Prefer: return=minimal']);
    }

    /**
     * Условное обновление с возвратом реально изменённых строк.
     *
     * Нулевой массив важен: это не «ошибка PATCH», а проигранный optimistic
     * CAS — кто-то успел изменить строку между нашим SELECT и UPDATE.
     */
    function sb_update_returning(string $t, array $f, array $data): array
    {
        return sb('PATCH', $t, $f, $data, ['Prefer: return=representation']);
    }

    /** Вставить или обновить по ключу конфликта — одним запросом на пачку. */
""",
    'returning conditional update helper',
)

old = """try {
    $application = sb_single('jm_partner_applications', [
        'source_id' => 'eq.' . $sourceId,
        'or' => '(id.eq.' . $applicationId . ',partner_application_id.eq.' . $applicationId . ')',
    ], '*');
    if (!$application) throw new RuntimeException('Application not found');
    $transition = pg_transition($application, $status, $version,
        isset($event['updated_at']) ? (string)$event['updated_at'] : null);
    if (!empty($transition['applied'])) {
        $next = $transition['application'];
        sb_update('jm_partner_applications', ['id' => 'eq.' . $application['id']], [
            'status' => $next['status'], 'status_version' => $next['status_version'],
            'updated_at' => $next['updated_at'],
            'partner_updated_at' => $next['partner_updated_at'] ?? null,
            'failure_code' => null, 'failure_message' => null,
        ]);
    }
    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processed_at' => now_iso(), 'processing_started_at' => null, 'processing_error' => null,
    ]);
    echo json_encode(['ok' => true, 'applied' => !empty($transition['applied']),
        'reason' => $transition['reason'] ?? null]);
} catch (Throwable $e) {
    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processing_started_at' => null,
        'processing_error' => substr($e->getMessage(), 0, 500),
    ]);
    http_response_code(422); echo json_encode(['error' => 'Event was not applied']);
}
"""
new = """try {
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
"""
replace_once('php-proxy/partner_webhook.php', old, new, 'atomic callback transition')

# Regression guards: unit transition rules stay in partner_core_test, and these
# pin the I/O-level concurrency contract that a pure transition test cannot see.
test = Path('tests/partner_core_test.php')
t = test.read_text()
anchor = 'echo "partner core: ok\\n";'
addition = r'''$lite = file_get_contents(__DIR__ . '/../php-proxy/sb_lite.php');
expect_true($lite !== false && str_contains($lite, 'function sb_update_returning'), 'conditional updates can report CAS misses');
$callback = file_get_contents(__DIR__ . '/../php-proxy/partner_webhook.php');
expect_true($callback !== false && str_contains($callback, "sb_update_returning('jm_partner_applications'"), 'callback uses conditional application update');
expect_true(str_contains($callback, "'status_version' => 'eq.' . (int)\$application['status_version']"), 'callback CAS includes previous version');
expect_true(str_contains($callback, "'status' => 'eq.' . (string)\$application['status']"), 'callback CAS includes previous status');
expect_true(str_contains($callback, 'for ($casAttempt = 0; $casAttempt < 4; $casAttempt++)'), 'callback retries a lost CAS');
expect_true(str_contains($callback, "http_response_code(409)"), 'out-of-order callback is retryable instead of false 200');
expect_true(str_contains($callback, "http_response_code(\$retryable ? 503 : 422)"), 'transient callback failures return 503');
expect_true(!preg_match("~sb_update\\('jm_partner_applications',[\\s\\S]{0,260}'status' => \\$next\\['status'\\]~", $callback), 'callback no longer blindly overwrites application status');

echo "partner core: ok\n";'''
if t.count(anchor) != 1:
    raise SystemExit(f'partner core anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
