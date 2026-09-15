from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# ── REST RPC helper used for atomic database claims. ─────────────────────────
replace_once(
    'php-proxy/sb_lite.php',
    """    function sb_upsert_rows(string $t, array $rows, string $on_conflict): void
    {
        if (!$rows) return;
        sb('POST', $t, ['on_conflict' => $on_conflict], $rows,
           ['Prefer: return=minimal,resolution=merge-duplicates']);
    }

    function now_iso(): string
""",
    """    function sb_upsert_rows(string $t, array $rows, string $on_conflict): void
    {
        if (!$rows) return;
        sb('POST', $t, ['on_conflict' => $on_conflict], $rows,
           ['Prefer: return=minimal,resolution=merge-duplicates']);
    }

    /** Вызов PostgREST RPC. Возвращаем строки результата как обычный массив. */
    function sb_rpc(string $name, array $args = []): array
    {
        return sb('POST', 'rpc/' . $name, [], $args, ['Prefer: return=representation']);
    }

    function now_iso(): string
""",
    'sb rpc helper',
)

# ── Outbox: claim exactly one event immediately before delivery. ─────────────
replace_once(
    'php-proxy/partner_outbox.php',
    """$events = sb_select('jm_partner_outbox', [
    'delivery_status' => 'in.(pending,failed)',
    'next_attempt_at' => 'lte.' . now_iso(),
    'limit' => '50',
    'order' => 'next_attempt_at.asc',
], '*');
$delivered = 0; $failed = 0; $dead = 0;

foreach ($events as $event) {
""",
    """$delivered = 0; $failed = 0; $dead = 0; $selected = 0;
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
""",
    'outbox atomic claim loop',
)
replace_once(
    'php-proxy/partner_outbox.php',
    """echo json_encode(['ok' => true, 'selected' => count($events), 'delivered' => $delivered,
    'retrying' => $failed, 'dead' => $dead], JSON_UNESCAPED_UNICODE);
""",
    """echo json_encode(['ok' => true, 'selected' => $selected, 'delivered' => $delivered,
    'retrying' => $failed, 'dead' => $dead], JSON_UNESCAPED_UNICODE);
""",
    'outbox selected count',
)

# ── Webhook inbox: duplicate delivery must be atomically claimed. ─────────────
replace_once(
    'php-proxy/partner_webhook.php',
    """$seen = sb_single('jm_partner_inbox', [
    'source_id' => 'eq.' . $sourceId, 'partner_event_id' => 'eq.' . $eventId,
], 'id,processed_at');
if ($seen && !empty($seen['processed_at'])) {
    echo json_encode(['ok' => true, 'duplicate' => true]); exit;
}
$inboxId = $seen['id'] ?? bin2hex(random_bytes(12));
if (!$seen) sb_insert('jm_partner_inbox', [
    'id' => $inboxId, 'source_id' => $sourceId, 'partner_event_id' => $eventId,
    'event_kind' => 'application.status', 'payload' => $event,
    'signature_valid' => true, 'received_at' => now_iso(),
]);

try {
""",
    """$claimRows = sb_rpc('jm_claim_partner_inbox', [
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
""",
    'webhook atomic inbox claim',
)
replace_once(
    'php-proxy/partner_webhook.php',
    """    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processed_at' => now_iso(), 'processing_error' => null,
    ]);
""",
    """    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processed_at' => now_iso(), 'processing_started_at' => null, 'processing_error' => null,
    ]);
""",
    'webhook success releases claim',
)
replace_once(
    'php-proxy/partner_webhook.php',
    """    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processing_error' => substr($e->getMessage(), 0, 500),
    ]);
""",
    """    sb_update('jm_partner_inbox', ['id' => 'eq.' . $inboxId], [
        'processing_started_at' => null,
        'processing_error' => substr($e->getMessage(), 0, 500),
    ]);
""",
    'webhook failure releases claim',
)

# ── Ingest library mode lets the load harness exercise production normalizer. ─
replace_once(
    'php-proxy/ingest.php',
    """$expectedAdmin = ing_secret('ADMIN_API_TOKEN');
if ($expectedAdmin === '') {
    $credFile = __DIR__ . '/admin_credentials.php';
    $creds = is_readable($credFile) ? @include $credFile : null;
    $expectedAdmin = is_array($creds) ? (string)($creds['password'] ?? '') : '';
}
$givenAdmin = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
if ($expectedAdmin === '' || !hash_equals($expectedAdmin, $givenAdmin)) {
    http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
}
""",
    """if (!defined('INGEST_LIBRARY_ONLY')) {
    $expectedAdmin = ing_secret('ADMIN_API_TOKEN');
    if ($expectedAdmin === '') {
        $credFile = __DIR__ . '/admin_credentials.php';
        $creds = is_readable($credFile) ? @include $credFile : null;
        $expectedAdmin = is_array($creds) ? (string)($creds['password'] ?? '') : '';
    }
    $givenAdmin = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($expectedAdmin === '' || !hash_equals($expectedAdmin, $givenAdmin)) {
        http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
    }
}
""",
    'ingest library auth guard',
)
replace_once(
    'php-proxy/ingest.php',
    """// ── Сам заход ─────────────────────────────────────────────────────────────

$only = trim((string)($_GET['source'] ?? ''));   // для кнопки «проверить сейчас»
""",
    """// ── Сам заход ─────────────────────────────────────────────────────────────

if (!defined('INGEST_LIBRARY_ONLY')) {
$only = trim((string)($_GET['source'] ?? ''));   // для кнопки «проверить сейчас»
""",
    'ingest library main guard start',
)
replace_once(
    'php-proxy/ingest.php',
    """echo json_encode(['ok' => true, 'sources' => count($sources), 'run' => $done], JSON_UNESCAPED_UNICODE);""",
    """echo json_encode(['ok' => true, 'sources' => count($sources), 'run' => $done], JSON_UNESCAPED_UNICODE);
}""",
    'ingest library main guard end',
)

# ── Atomic claim migration. ──────────────────────────────────────────────────
Path('supabase/migrations/067_partner_queue_claims.sql').write_text(r'''-- Атомарные lease-claims для партнёрского outbox/inbox.
-- Нужны именно в БД: схема «SELECT, потом UPDATE» допускает, что два cron/
-- webhook-процесса одновременно возьмут одну и ту же работу.

alter table public.jm_partner_inbox
  add column if not exists processing_started_at timestamptz;

create index if not exists jm_partner_outbox_sending_lock_idx
  on public.jm_partner_outbox (locked_at)
  where delivery_status = 'sending';

create index if not exists jm_partner_inbox_processing_idx
  on public.jm_partner_inbox (processing_started_at)
  where processed_at is null and processing_started_at is not null;

create or replace function public.jm_claim_partner_outbox(p_limit integer default 50)
returns setof public.jm_partner_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  with due as (
    select id
    from public.jm_partner_outbox
    where (
      delivery_status in ('pending', 'failed')
      and next_attempt_at <= now()
    ) or (
      delivery_status = 'sending'
      and (locked_at is null or locked_at <= now() - interval '2 minutes')
    )
    order by
      case when delivery_status = 'sending' then locked_at else next_attempt_at end asc nulls first,
      created_at asc,
      id asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.jm_partner_outbox o
  set delivery_status = 'sending', locked_at = now()
  from due
  where o.id = due.id
  returning o.*;
$$;

create or replace function public.jm_claim_partner_inbox(
  p_id text,
  p_source_id text,
  p_partner_event_id text,
  p_event_kind text,
  p_payload jsonb
)
returns table(inbox_id text, claim_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.jm_partner_inbox%rowtype;
begin
  insert into public.jm_partner_inbox (
    id, source_id, partner_event_id, event_kind, payload,
    signature_valid, received_at
  ) values (
    p_id, p_source_id, p_partner_event_id, p_event_kind, p_payload,
    true, now()
  )
  on conflict (source_id, partner_event_id) do nothing;

  select * into v_row
  from public.jm_partner_inbox
  where source_id = p_source_id and partner_event_id = p_partner_event_id
  for update;

  if v_row.id is null then
    raise exception 'partner inbox row disappeared';
  end if;

  -- Event id is the idempotency key. Reusing it for another signed payload is
  -- not a retry and must not silently mutate the first event.
  if v_row.payload is distinct from p_payload then
    return query select v_row.id, 'conflict'::text;
    return;
  end if;

  if v_row.processed_at is not null then
    return query select v_row.id, 'duplicate'::text;
    return;
  end if;

  -- A crashed request releases itself after a short lease. Normal webhook
  -- processing is a handful of DB calls, so two minutes leaves ample margin.
  if v_row.processing_started_at is not null
     and v_row.processing_started_at > now() - interval '2 minutes' then
    return query select v_row.id, 'busy'::text;
    return;
  end if;

  update public.jm_partner_inbox
  set processing_started_at = now(), processing_error = null
  where id = v_row.id;

  return query select v_row.id, 'claimed'::text;
end;
$$;

revoke all on function public.jm_claim_partner_outbox(integer) from public, anon, authenticated;
revoke all on function public.jm_claim_partner_inbox(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.jm_claim_partner_outbox(integer) to service_role;
grant execute on function public.jm_claim_partner_inbox(text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
''')

# ── Feed load harness: production normalizer, synthetic data, no network/DB. ──
Path('tests/partner_feed_load_test.php').write_text(r'''<?php
// Безопасный нагрузочный прогон нормализации большого партнёрского фида.
// Никакой production-сети/БД: подключается ровно production-код нормализации.
define('INGEST_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/ingest.php';

function load_fail(string $message): void {
    fwrite(STDERR, "partner feed load: FAIL: $message\n");
    exit(1);
}

$rows = (int)(getenv('PARTNER_LOAD_ROWS') ?: '50000');
if ($rows < 1000 || $rows > 250000) load_fail('PARTNER_LOAD_ROWS out of safe range');

$start = hrtime(true);
$memStart = memory_get_usage(true);
$keys = [];
$batches = 0;
$batch = [];
$sampleMetro = null;

for ($i = 0; $i < $rows; $i++) {
    $title = match ($i % 3) {
        0 => 'Сборщик заказов',
        1 => 'Кладовщик',
        default => 'Повар',
    };
    $item = [
        'id' => 'load-' . $i,
        'title' => $title,
        'company' => 'Load Partner ' . ($i % 17),
        'metro' => 'м. Тёплый Стан, 7 минут пешком',
        'address' => 'Москва, тестовый адрес ' . $i,
        'kind' => ($i % 5 === 0) ? 'permanent' : 'shift',
        'date' => '2026-09-' . sprintf('%02d', 16 + ($i % 10)),
        'time_start' => '09:00',
        'time_end' => '18:00',
        'pay' => 5000 + ($i % 3000),
        'pay_period' => ($i % 5 === 0) ? 'month' : 'shift',
        'url' => 'https://partner.example/v/' . $i,
        'description' => 'Синтетическая запись для безопасного нагрузочного прогона.',
        'active' => true,
    ];
    $row = ing_normalize($item, 'load-source');
    if (!is_array($row)) load_fail("row $i did not normalize");
    if ($sampleMetro === null) $sampleMetro = $row['metro_station_norm'] ?? null;
    $key = (string)($row['id'] ?? '');
    if ($key === '' || isset($keys[$key])) load_fail("duplicate normalized id at row $i");
    $keys[$key] = true;
    $batch[] = $row;
    if (count($batch) === 200) {
        // Та же форма пачки, с которой production идёт в upsert; БД не трогаем.
        json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $batches++;
        $batch = [];
    }
}
if ($batch) {
    json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $batches++;
}

$elapsedMs = (hrtime(true) - $start) / 1_000_000;
$peakDeltaMb = max(0, memory_get_peak_usage(true) - $memStart) / 1048576;
if (count($keys) !== $rows) load_fail('normalized row count mismatch');
if ($sampleMetro !== 'Тёплый Стан') load_fail('production metro normalization changed');
if ($elapsedMs > 30000) load_fail(sprintf('normalization too slow: %.0f ms', $elapsedMs));
if ($peakDeltaMb > 256) load_fail(sprintf('memory spike too high: %.1f MB', $peakDeltaMb));

printf(
    "partner feed load: OK rows=%d batches=%d elapsed_ms=%.0f peak_delta_mb=%.1f rows_per_sec=%.0f\n",
    $rows, $batches, $elapsedMs, $peakDeltaMb,
    $elapsedMs > 0 ? ($rows * 1000 / $elapsedMs) : 0
);
''')

# ── Queue load harness: ephemeral Postgres only. ──────────────────────────────
Path('tests/partner_queue_load.sh').write_text(r'''#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required and must point to an ephemeral test Postgres}"

psqlq() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }

psqlq <<'SQL'
drop table if exists public.jm_partner_outbox cascade;
drop table if exists public.jm_partner_inbox cascade;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.jm_partner_outbox (
  id text primary key,
  source_id text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_kind text not null,
  idempotency_key text not null,
  payload jsonb not null,
  delivery_status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (source_id, idempotency_key)
);
create table public.jm_partner_inbox (
  id text primary key,
  source_id text not null,
  partner_event_id text not null,
  event_kind text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (source_id, partner_event_id)
);
SQL
psqlq -f supabase/migrations/067_partner_queue_claims.sql >/dev/null

psqlq <<'SQL'
insert into public.jm_partner_outbox (
  id, source_id, aggregate_type, aggregate_id, event_kind,
  idempotency_key, payload, delivery_status, next_attempt_at
)
select
  'e-' || g, 's1', 'application', 'a-' || g, 'application.submit',
  'idem-' || g, '{}'::jsonb, 'pending', now() - interval '1 second'
from generate_series(1, 5000) g;
SQL

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
workers=20
claims_per_worker=5
start_ns="$(date +%s%N)"
for w in $(seq 1 "$workers"); do
  (
    for _ in $(seq 1 "$claims_per_worker"); do
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt \
        -c "select id from public.jm_claim_partner_outbox(50) order by id;"
    done
  ) >"$tmp/outbox-$w" &
done
wait
elapsed_ms=$(( ( $(date +%s%N) - start_ns ) / 1000000 ))
cat "$tmp"/outbox-* | sed '/^$/d' | sort >"$tmp/all"
claimed="$(wc -l <"$tmp/all" | tr -d ' ')"
unique="$(uniq "$tmp/all" | wc -l | tr -d ' ')"
sending="$(psqlq -c "select count(*) from public.jm_partner_outbox where delivery_status='sending';")"
[[ "$claimed" == "5000" ]] || { echo "partner queue load: FAIL claimed=$claimed" >&2; exit 1; }
[[ "$unique" == "5000" ]] || { echo "partner queue load: FAIL duplicate claims unique=$unique" >&2; exit 1; }
[[ "$sending" == "5000" ]] || { echo "partner queue load: FAIL sending=$sending" >&2; exit 1; }

# Crashed worker lease is recoverable.
psqlq -c "update public.jm_partner_outbox set locked_at=now()-interval '10 minutes' where id='e-1';"
reclaimed="$(psqlq -c "select id from public.jm_claim_partner_outbox(1);")"
[[ "$reclaimed" == "e-1" ]] || { echo "partner queue load: FAIL stale outbox was not reclaimed" >&2; exit 1; }

# Twenty concurrent deliveries of the same webhook event: exactly one owner.
for w in $(seq 1 20); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c \
    "select claim_status from public.jm_claim_partner_inbox('inbox-$w','s1','same-event','application.status','{\"status\":\"booked\"}'::jsonb);" \
    >"$tmp/inbox-$w" &
done
wait
claimed_inbox="$(grep -h '^claimed$' "$tmp"/inbox-* | wc -l | tr -d ' ')"
busy_inbox="$(grep -h '^busy$' "$tmp"/inbox-* | wc -l | tr -d ' ')"
[[ "$claimed_inbox" == "1" ]] || { echo "partner queue load: FAIL inbox claimed=$claimed_inbox" >&2; exit 1; }
[[ "$busy_inbox" == "19" ]] || { echo "partner queue load: FAIL inbox busy=$busy_inbox" >&2; exit 1; }

psqlq -c "update public.jm_partner_inbox set processed_at=now(), processing_started_at=null where source_id='s1' and partner_event_id='same-event';"
duplicate="$(psqlq -c "select claim_status from public.jm_claim_partner_inbox('ignored','s1','same-event','application.status','{\"status\":\"booked\"}'::jsonb);")"
[[ "$duplicate" == "duplicate" ]] || { echo "partner queue load: FAIL processed duplicate=$duplicate" >&2; exit 1; }
conflict="$(psqlq -c "select claim_status from public.jm_claim_partner_inbox('ignored','s1','same-event','application.status','{\"status\":\"completed\"}'::jsonb);")"
[[ "$conflict" == "conflict" ]] || { echo "partner queue load: FAIL event-id payload conflict=$conflict" >&2; exit 1; }

printf 'partner queue load: OK events=5000 workers=%d elapsed_ms=%d unique_claims=%d inbox_race=1/%d\n' \
  "$workers" "$elapsed_ms" "$unique" "$claimed_inbox"
''')

# ── Regression guards live in the normal CI suite. ───────────────────────────
test = Path('tests/partner_core_test.php')
t = test.read_text()
anchor = 'echo "partner core: ok\\\\n";'
addition = r'''$queueMigration = file_get_contents(__DIR__ . '/../supabase/migrations/067_partner_queue_claims.sql');
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

echo "partner core: ok\\n";'''
if t.count(anchor) != 1:
    raise SystemExit(f'partner core anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
