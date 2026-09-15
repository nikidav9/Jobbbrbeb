-- Атомарные lease-claims для партнёрского outbox/inbox.
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
