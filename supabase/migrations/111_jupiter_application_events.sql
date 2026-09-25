-- История отклика Юпитера: шаги для карточки отклика в приложении.
--
-- Пишет триггер, а не каждый вызов в db.php: состояние меняют десяток
-- функций (очередь, воркер, согласие, ручная отправка), и забытая запись
-- в одной из них тихо дырявила бы историю. Промежуточные шаги прогона
-- (opening_site, filling, submitting…) не пишутся — это не события для
-- человека, а внутренняя кухня одной попытки.
create table if not exists public.jm_jupiter_events (
  id bigint generated always as identity primary key,
  application_id text not null references public.jm_jupiter_applications(id) on delete cascade,
  user_id text not null,
  kind text not null,          -- created | consent | состояние отклика
  reason_code text,
  -- Сводка заполнения от воркера: {"fields": 5, "keys": [...], "resume": true}.
  -- Только ключи смысла полей и счётчики, без значений.
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists jm_jupiter_events_by_application
  on public.jm_jupiter_events (application_id, created_at);

alter table public.jm_jupiter_events enable row level security;
revoke all on public.jm_jupiter_events from anon, authenticated;

create or replace function public.jm_jupiter_log_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  last_kind text;
  last_reason text;
  summary jsonb;
begin
  if tg_op = 'INSERT' then
    insert into jm_jupiter_events(application_id, user_id, kind, created_at)
      values (new.id, new.user_id, 'created', new.created_at);
  end if;

  if tg_op = 'UPDATE' and new.third_party_consent_at is not null
     and old.third_party_consent_at is null then
    insert into jm_jupiter_events(application_id, user_id, kind)
      values (new.id, new.user_id, 'consent');
  end if;

  if new.state not in ('queued', 'ready_to_submit', 'submitted', 'action_required',
                       'submission_unknown', 'duplicate', 'retryable_failed', 'failed') then
    return new;
  end if;

  -- Повтор того же шага (очередь после очереди, та же ошибка на повторе)
  -- в историю второй раз не идёт.
  select kind, reason_code into last_kind, last_reason
    from jm_jupiter_events
   where application_id = new.id and kind not in ('created', 'consent')
   order by created_at desc, id desc limit 1;
  if last_kind is not distinct from new.state
     and last_reason is not distinct from new.reason_code then
    return new;
  end if;

  if jsonb_typeof(new.checkpoint) = 'object' and new.checkpoint ? 'summary' then
    summary := new.checkpoint -> 'summary';
  end if;
  insert into jm_jupiter_events(application_id, user_id, kind, reason_code, detail)
    values (new.id, new.user_id, new.state, new.reason_code, summary);
  return new;
end;
$$;
revoke all on function public.jm_jupiter_log_event() from public, anon, authenticated;

drop trigger if exists jm_jupiter_log_event on public.jm_jupiter_applications;
create trigger jm_jupiter_log_event
  after insert or update on public.jm_jupiter_applications
  for each row execute function public.jm_jupiter_log_event();

-- Уже существующие отклики: создание и текущее состояние, чтобы карточка
-- не была пустой. Промежуточной истории у них нет — она нигде не хранилась.
insert into public.jm_jupiter_events(application_id, user_id, kind, created_at)
select a.id, a.user_id, 'created', a.created_at
  from public.jm_jupiter_applications a
 where not exists (select 1 from public.jm_jupiter_events e where e.application_id = a.id);

insert into public.jm_jupiter_events(application_id, user_id, kind, reason_code, created_at)
select a.id, a.user_id, a.state, a.reason_code, greatest(a.updated_at, a.created_at + interval '1 second')
  from public.jm_jupiter_applications a
 where a.state in ('queued', 'ready_to_submit', 'submitted', 'action_required',
                   'submission_unknown', 'duplicate', 'retryable_failed', 'failed')
   and not exists (select 1 from public.jm_jupiter_events e
                    where e.application_id = a.id and e.kind not in ('created', 'consent'));
