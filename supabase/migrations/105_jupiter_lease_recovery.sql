-- Осиротевшие задачи нельзя оставлять в opening_application навсегда.
-- После истечения аренды безопасные этапы можно повторить. Если воркер
-- исчез во время отправки, повторять запрос работодателю нельзя.
create or replace function jupiter_lease_task(p_worker text, p_lease_seconds integer)
returns jm_jupiter_applications
language plpgsql
security definer
set search_path = public
as $$
declare
    task jm_jupiter_applications;
begin
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
    where (
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

revoke all on function jupiter_lease_task(text, integer) from public;
revoke all on function jupiter_lease_task(text, integer) from anon;
revoke all on function jupiter_lease_task(text, integer) from authenticated;
