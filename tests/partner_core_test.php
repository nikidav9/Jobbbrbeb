<?php
require_once __DIR__ . '/../php-proxy/partner_core.php';
require_once __DIR__ . '/../php-proxy/partner_billing.php';

function expect_true(bool $value, string $message): void {
    if (!$value) {
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
}

expect_true(pg_can_transition('local_created', 'submitting'), 'application can submit');
expect_true(pg_can_transition('submitted', 'accepted'), 'submitted can be accepted');
expect_true(pg_can_transition('accepted', 'booked'), 'accepted can be booked');
expect_true(pg_can_transition('booked', 'checked_in'), 'booked can check in');
expect_true(pg_can_transition('checked_in', 'completed'), 'checked in can complete');
expect_true(!pg_can_transition('completed', 'submitted'), 'terminal state cannot move backwards');
expect_true(pg_can_transition('completed', 'completed'), 'duplicate event is idempotent');

$app = ['status' => 'booked', 'status_version' => 4];
$stale = pg_transition($app, 'checked_in', 4);
expect_true($stale['applied'] === false && $stale['reason'] === 'stale', 'stale version ignored');

$next = pg_transition($app, 'checked_in', 5, '2026-09-02T12:00:00Z');
expect_true($next['applied'] === true, 'new transition applied');
expect_true($next['application']['status'] === 'checked_in', 'status changed');
expect_true($next['application']['status_version'] === 5, 'version changed');

$invalid = pg_transition($app, 'completed', 5);
expect_true($invalid['applied'] === false && $invalid['reason'] === 'invalid_transition', 'invalid jump rejected');

$timestamp = (string)time();
$body = '{"event_id":"e1"}';
$sig = pg_webhook_signature('secret', $timestamp, $body);
expect_true(pg_verify_webhook('secret', $timestamp, $body, 'sha256=' . $sig), 'valid webhook accepted');
expect_true(!pg_verify_webhook('secret', $timestamp, $body . 'x', $sig), 'changed body rejected');
expect_true(!pg_verify_webhook('secret', (string)(time() - 301), $body, pg_webhook_signature('secret', (string)(time() - 301), $body)), 'old webhook rejected');

$completed = pg_rating_fact_for_status('completed', []);
expect_true($completed['fact_kind'] === 'shift_completed', 'completion becomes evidence');
$late = pg_rating_fact_for_status('checked_in', ['late_minutes' => 12]);
expect_true($late['fact_kind'] === 'late_minutes' && $late['numeric_value'] === 12, 'lateness preserved');
$ontime = pg_rating_fact_for_status('checked_in', ['late_minutes' => 0]);
expect_true($ontime['fact_kind'] === 'on_time', 'zero lateness becomes on-time fact');

$sandboxMigration = file_get_contents(__DIR__ . '/../supabase/migrations/046_partner_sandbox_isolation.sql');
expect_true($sandboxMigration !== false, 'sandbox migration exists');
expect_true(str_contains($sandboxMigration, "environment <> 'sandbox' or notifications_enabled = false"), 'sandbox notifications are forbidden');
expect_true(str_contains($sandboxMigration, "environment = 'production' and active = true"), 'public policy exposes production only');

$dbProxy = file_get_contents(__DIR__ . '/../php-proxy/db.php');
expect_true($dbProxy !== false && str_contains($dbProxy, "'environment' => 'eq.production'"), 'API hides sandbox vacancies');

$metricsMigration = file_get_contents(__DIR__ . '/../supabase/migrations/047_partner_business_metrics.sql');
expect_true($metricsMigration !== false, 'partner business metrics migration exists');
expect_true(str_contains($metricsMigration, 'jm_partner_costs'), 'partner costs are factual ledger entries');
expect_true(str_contains($metricsMigration, 'new_candidate boolean'), 'partner confirms candidate novelty');

$conversionApi = file_get_contents(__DIR__ . '/../php-proxy/api.php');
expect_true($conversionApi !== false && str_contains($conversionApi, "'new_candidate' => " . '$newCandidate'), 'conversion callback stores partner novelty');
expect_true(str_contains($conversionApi, "'user_id' => " . '$clickId'), 'conversion keeps attributed worker');

expect_true(str_contains($dbProxy, "'партнёрский_отчёт_30дней'"), 'dashboard API exposes partner report');
expect_true(str_contains($dbProxy, "'стоимость_отклика_rub'"), 'cost per response is reported');
expect_true(str_contains($dbProxy, '$knownNew > 0'), 'unknown novelty is not shown as zero');

$sourcePage = file_get_contents(__DIR__ . '/../dashboard/app/sources/page.tsx');
expect_true($sourcePage !== false && str_contains($sourcePage, 'Отчёт для партнёра · 30 дней'), 'partner report is visible');
expect_true(str_contains($sourcePage, 'Неизвестные значения не заменяются нулями'), 'dashboard labels incomplete data honestly');

$billingMigration = file_get_contents(__DIR__ . '/../supabase/migrations/048_partner_billing_and_reconciliation.sql');
expect_true($billingMigration !== false, 'billing migration exists');
expect_true(str_contains($billingMigration, 'jm_partner_first_shift_once_idx'), 'database prevents double first-shift payment');
expect_true(str_contains($billingMigration, 'jm_partner_reconciliation_issues'), 'reconciliation ledger exists');
expect_true(str_contains($billingMigration, 'jm_partner_data_consents'), 'partner consent evidence exists');

$tariffs = [[
    'id' => 't1', 'source_id' => 's1', 'billing_model' => 'first_completed_shift',
    'amount_rub' => 500, 'effective_from' => '2026-09-01', 'effective_to' => null, 'active' => true,
]];
$billable = pb_build_billable_event([
    'source_id' => 's1', 'worker_id' => 'w1', 'event_kind' => 'first_completed_shift',
    'application_id' => 'a1', 'partner_event_id' => 'e1', 'occurred_at' => '2026-09-02T12:00:00Z',
], $tariffs);
expect_true($billable['created'] === true && $billable['billable_event']['amount_rub'] === 500.0, 'tariff produces billable event');
$duplicate = pb_build_billable_event([
    'source_id' => 's1', 'worker_id' => 'w1', 'event_kind' => 'first_completed_shift',
    'application_id' => 'a2', 'partner_event_id' => 'e2', 'occurred_at' => '2026-09-03T12:00:00Z',
], $tariffs, [$billable['billable_event']['dedupe_key']]);
expect_true($duplicate['reason'] === 'duplicate', 'same worker is not charged twice');

$partnerRoute = file_get_contents(__DIR__ . '/../dashboard/app/api/partner/report/route.ts');
expect_true($partnerRoute !== false && str_contains($partnerRoute, 'PARTNER_PORTAL_TOKENS_JSON'), 'partner portal is source-scoped');
expect_true(str_contains($partnerRoute, "format === 'xlsx'"), 'XLSX export exists');
$consentSheet = file_get_contents(__DIR__ . '/../components/feature/PartnerConsentSheet.tsx');
expect_true($consentSheet !== false && str_contains($consentSheet, 'Получатель:'), 'specific partner is shown before transfer');

$queueMigration = file_get_contents(__DIR__ . '/../supabase/migrations/067_partner_queue_claims.sql');
expect_true($queueMigration !== false, 'partner queue claim migration exists');
expect_true(str_contains($queueMigration, 'for update skip locked'), 'outbox claims use row locking');
expect_true(str_contains($queueMigration, "'conflict'::text"), 'webhook event id cannot be reused with another payload');
$outboxWorker = file_get_contents(__DIR__ . '/../php-proxy/partner_outbox.php');
expect_true($outboxWorker !== false && str_contains($outboxWorker, "sb_rpc('jm_claim_partner_outbox'"), 'outbox is claimed atomically');
expect_true(!str_contains($outboxWorker, "sb_select('jm_partner_outbox'"), 'outbox no longer uses select-then-send race');
$partnerWebhook = file_get_contents(__DIR__ . '/../php-proxy/partner_webhook.php');
expect_true($partnerWebhook !== false && str_contains($partnerWebhook, "sb_rpc('jm_claim_partner_inbox'"), 'webhook inbox is claimed atomically');
expect_true(str_contains($partnerWebhook, "'processing_started_at' => null"), 'webhook claim is released after processing');
$ingest = file_get_contents(__DIR__ . '/../php-proxy/ingest.php');
expect_true($ingest !== false && str_contains($ingest, "INGEST_LIBRARY_ONLY"), 'feed normalizer can be load-tested without production I/O');

echo "partner core: ok\\n";
