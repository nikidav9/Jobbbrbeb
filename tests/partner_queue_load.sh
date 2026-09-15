#!/usr/bin/env bash
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
