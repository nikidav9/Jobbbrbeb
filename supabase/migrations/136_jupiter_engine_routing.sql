-- Эскалация на браузер (решение владельца 29.09.2026). У заявки свой движок:
-- 'http' — быстрый HTTP-движок Юпитера (по умолчанию), 'browser' — Chromium.
-- Каждый воркер берёт только заявки своего движка, иначе оба хватали бы одни
-- и те же. На 'browser' заявку переводит сервер (jupiterFinish в db.php),
-- когда HTTP-движок упёрся в анкету на скрипте, и только если браузерная
-- служба включена, а человек принял Соглашение 2026-09-29.
begin;

alter table jm_jupiter_applications
    add column if not exists engine text not null default 'http';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'jm_jupiter_applications_engine_check'
    ) then
        alter table jm_jupiter_applications
            add constraint jm_jupiter_applications_engine_check
            check (engine in ('http', 'browser'));
    end if;
end $$;

create index if not exists jm_jupiter_applications_engine_queue_idx
    on jm_jupiter_applications (engine, state, created_at);

create or replace function jupiter_lease_task(p_worker text, p_lease_seconds integer, p_engine text)
returns jm_jupiter_applications
language plpgsql
security definer
set search_path = public
as $$
declare
    task jm_jupiter_applications;
begin
    if p_engine not in ('http', 'browser') then
        raise exception 'unknown engine %', p_engine;
    end if;

    update jm_jupiter_applications
    set state = 'submission_unknown',
        reason_code = 'LEASE_EXPIRED_DURING_SUBMISSION',
        lease_owner = null,
        lease_until = null,
        updated_at = now()
    where state in ('submitting', 'verifying')
      and lease_owner is not null
      and lease_until <= now();

    update jm_jupiter_applications
    set state = 'failed',
        reason_code = 'LEASE_EXPIRED_REPEATEDLY',
        lease_owner = null,
        lease_until = null,
        updated_at = now()
    where state in ('opening_site', 'finding_vacancy', 'opening_application',
                    'filling', 'validating')
      and lease_owner is not null
      and lease_until <= now()
      and attempt_count >= 3;

    select * into task
    from jm_jupiter_applications
    where engine = p_engine
      and (
        state in ('queued', 'retryable_failed')
        or (
            state in ('opening_site', 'finding_vacancy', 'opening_application',
                      'filling', 'validating')
            and lease_owner is not null
            and lease_until <= now()
            and attempt_count < 3
        )
      )
      and (not_before is null or not_before <= now())
      and (lease_owner is null or lease_until is null or lease_until <= now())
    order by created_at
    for update skip locked
    limit 1;

    if not found then
        return null;
    end if;

    update jm_jupiter_applications
    set lease_owner = p_worker,
        lease_until = now() + make_interval(secs => p_lease_seconds),
        heartbeat_at = now(),
        attempt_count = attempt_count + 1,
        state = 'opening_site',
        updated_at = now()
    where id = task.id
    returning * into task;

    return task;
end;
$$;

-- Прежний вызов (воркеры до этой миграции) — это HTTP-движок.
create or replace function jupiter_lease_task(p_worker text, p_lease_seconds integer)
returns jm_jupiter_applications
language sql
security definer
set search_path = public
as $$
    select * from jupiter_lease_task(p_worker, p_lease_seconds, 'http');
$$;

revoke all on function jupiter_lease_task(text, integer, text) from public;
revoke all on function jupiter_lease_task(text, integer, text) from anon;
revoke all on function jupiter_lease_task(text, integer, text) from authenticated;
grant execute on function jupiter_lease_task(text, integer, text) to service_role;

revoke all on function jupiter_lease_task(text, integer) from public;
revoke all on function jupiter_lease_task(text, integer) from anon;
revoke all on function jupiter_lease_task(text, integer) from authenticated;
grant execute on function jupiter_lease_task(text, integer) to service_role;

commit;
