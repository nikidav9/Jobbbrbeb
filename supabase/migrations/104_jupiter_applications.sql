-- Заявки, которые Jupiter подаёт на внешних карьерных сайтах.
--
-- Отдельно от jm_perm_applications, и это не дублирование. Та таблица про
-- отклик внутри JobToo: там есть employer_id, статус решает работодатель, и
-- всё происходит у нас. Здесь другое: внешний сайт, чужая форма, доказательства
-- отправки и состояние фонового прогона. Складывать это в одну таблицу значило
-- бы смешать два разных жизненных цикла.

create table if not exists jm_jupiter_applications (
    id                       text primary key,
    user_id                  text not null,
    vacancy_url              text not null,
    -- Адрес без рекламных меток. По нему считается повтор: та же вакансия из
    -- рассылки и из ленты — один и тот же отклик.
    canonical_url            text not null,
    company                  text,
    state                    text not null default 'queued',
    reason_code              text,
    attempt_count            integer not null default 0,
    -- Аренда воркера: кто взял задачу и до какого момента она за ним.
    lease_owner              text,
    lease_until              timestamptz,
    heartbeat_at             timestamptz,
    -- Пауза перед повтором.
    not_before               timestamptz,
    checkpoint               jsonb,
    -- Токен возврата, когда прогон ждёт человека (капча, код, вход).
    resume_token             text,
    -- Ключ чека об отправке и номер заявки у работодателя, если он его выдал.
    receipt_key              text,
    external_application_id  text,
    last_error               text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    submitted_at             timestamptz,
    verified_at              timestamptz
);

-- Главная защита от второго отклика — здесь, а не в коде. Проверка в агенте
-- может не сработать из-за гонки двух воркеров; уникальный индекс не может.
create unique index if not exists jm_jupiter_applications_once
    on jm_jupiter_applications (user_id, canonical_url);

-- Выборка воркера: очередь смотрит незавершённые задачи, у которых подошло
-- время. Частичный индекс вместо полного: завершённых со временем станет
-- большинство, и держать их в индексе очереди незачем.
create index if not exists jm_jupiter_applications_queue
    on jm_jupiter_applications (not_before, created_at)
    where state in ('queued', 'retryable_failed');

-- Список человека в приложении: свежие сверху.
create index if not exists jm_jupiter_applications_by_user
    on jm_jupiter_applications (user_id, created_at desc);

-- Построчная защита включается, политик нет: доступ только у сервисного
-- ключа, то есть у php-proxy. Тот же порядок, что у остальных таблиц
-- (см. 013_lock_down_rls.sql).
alter table jm_jupiter_applications enable row level security;
revoke all on jm_jupiter_applications from anon;
revoke all on jm_jupiter_applications from authenticated;

-- Взятие задачи воркером — одним запросом в базе, а не чтением и записью из
-- PHP. Между «выбрал» и «пометил» два воркера успевают выбрать одну и ту же
-- строку, и работодатель получает два отклика. `for update skip locked` это
-- исключает: строку видит ровно один.
create or replace function jupiter_lease_task(p_worker text, p_lease_seconds integer)
returns jm_jupiter_applications
language plpgsql
security definer
set search_path = public
as $$
declare
    task jm_jupiter_applications;
begin
    select * into task
    from jm_jupiter_applications
    where state in ('queued', 'retryable_failed')
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

-- Звать её может только сервисный ключ: публичные роли к таблице не допущены,
-- а функция security definer обошла бы это ограничение.
revoke all on function jupiter_lease_task(text, integer) from public;
revoke all on function jupiter_lease_task(text, integer) from anon;
revoke all on function jupiter_lease_task(text, integer) from authenticated;
