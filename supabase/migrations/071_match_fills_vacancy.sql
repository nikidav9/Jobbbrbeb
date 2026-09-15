-- Мэтч снова набирает смену и закрывает её, когда людей хватило.
--
-- Что сломалось. Миграция 069 свела мэтч, чат и системные сообщения в одну
-- транзакцию — это правильно и остаётся. Но вместе с прежним кодом
-- dbCheckAndCreateMatch исчезли две строки, которых в новой функции не
-- появилось: инкремент jm_vacancies.workers_found и перевод смены в 'closed'
-- при наборе. Писать workers_found после этого стало НЕКОМУ: единственный
-- оставшийся путь, dbUpdateVacancy, зовётся с одним лишь status при
-- автозакрытии по времени.
--
-- Чем это обернулось на проде. Смена не закрывается, набрав людей, и висит в
-- ленте — на неё откликаются сверх нужного. `spots_left` в api.php считается
-- как workers_needed минус ноль, то есть партнёру мы всегда обещаем полный
-- набор мест. Доля закрытия смен в дашборде читает те же нули.
--
-- Почему инкремент обязан жить здесь, а не в PHP после вызова. Ровно за этим
-- 069 и писалась: шаг, сделанный отдельным запросом после commit, теряется при
-- обрыве. Набор — часть мэтча, а не следствие.
--
-- Три решения, которые стоит прочитать до правки.
--
-- 1. Считаем только при СОЗДАНИИ мэтча (v_match_created). Повтор RPC после
--    потерянного HTTP-ответа безопасен и не накручивает счётчик — это то же
--    правило, по которому здесь не дублируются системные сообщения.
-- 2. Строку вакансии берём FOR UPDATE. Два мэтча по одной смене одновременно
--    прочитали бы одинаковый workers_found и записали бы одинаковое +1: один
--    выход на смену потерялся бы. Блокировка идёт сразу за блокировкой отклика
--    и до advisory-lock'а пары — порядок один для всех вызовов, поэтому
--    взаимной блокировки не возникает.
-- 3. Смену только ЗАКРЫВАЕМ. Прежний код писал status = 'open', когда набор не
--    полон, и этим переоткрывал смену, которую работодатель закрыл руками.
--    Здесь это не воспроизводится: закрытая смена закрытой и остаётся.
--
-- Возвращаем ещё и vacancy_closed: карту сайта собирают только открытые
-- вакансии, и закрытие смены делает кэш картой несуществующего адреса.
-- Сбросить его отсюда нельзя — это дело PHP, и флаг ему об этом говорит.

-- Транзакция здесь не для красоты, и она единственная во всей папке миграций.
-- Причина: ниже DROP, а migrate.sh отдаёт файл в psql без --single-transaction,
-- то есть каждая команда коммитится сама. Между DROP и CREATE функции на проде
-- не существовало бы, и мэтч, пришедший в эту щель, упал бы. DDL в PostgreSQL
-- транзакционен, так что BEGIN закрывает щель целиком.
begin;

-- DROP обязателен: в returns table добавилась колонка vacancy_closed, а
-- CREATE OR REPLACE не умеет менять тип возврата — упал бы на «cannot change
-- return type of existing function».
drop function if exists public.jm_match_shift_atomic(text, text, text);

create function public.jm_match_shift_atomic(
  p_vacancy_id text,
  p_worker_id text,
  p_chat_id text
)
returns table(
  chat_id text,
  matched boolean,
  chat_created boolean,
  repaired boolean,
  vacancy_closed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_like public.jm_likes%rowtype;
  v_vac public.jm_vacancies%rowtype;
  v_chat_id text;
  v_match_created boolean := false;
  v_chat_created boolean := false;
  v_repaired boolean := false;
  v_vacancy_closed boolean := false;
  v_found integer;
  v_needed integer;
  v_card text;
  v_when text;
  v_where text;
  v_date text;
begin
  if nullif(btrim(coalesce(p_vacancy_id, '')), '') is null then
    raise exception 'vacancy id is required';
  end if;
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'worker id is required';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null then
    raise exception 'chat id is required';
  end if;

  select * into v_like
  from public.jm_likes
  where vacancy_id = p_vacancy_id
    and worker_id = p_worker_id
  for update;

  if not found then
    return query select null::text, false, false, false, false;
    return;
  end if;

  -- Пока обе стороны не выбрали друг друга, создавать мэтч нечего.
  if coalesce(v_like.worker_liked, false) is not true
     or v_like.employer_liked is distinct from true then
    return query select null::text, false, false, false, false;
    return;
  end if;

  -- FOR UPDATE: см. решение 2 в шапке. Без него одновременные мэтчи по одной
  -- смене затирают инкремент друг друга.
  select * into v_vac
  from public.jm_vacancies
  where id = p_vacancy_id
  for update;

  if not found then
    raise exception 'vacancy not found';
  end if;
  if v_vac.employer_id is distinct from v_like.employer_id then
    raise exception 'like employer does not own vacancy';
  end if;

  if coalesce(v_like.is_match, false) is not true then
    update public.jm_likes
       set is_match = true,
           matched_at = now()
     where id = v_like.id;
    v_match_created := true;
  end if;

  -- Набор считаем один раз на мэтч. Повтор вызова сюда не заходит.
  if v_match_created then
    v_found := coalesce(v_vac.workers_found, 0) + 1;
    -- 999 вместо null повторяет прежнее поведение: смена без указанного числа
    -- людей сама не закрывается, её закрывает работодатель.
    v_needed := coalesce(nullif(v_vac.workers_needed, 0), 999);
    v_vacancy_closed := v_found >= v_needed and v_vac.status is distinct from 'closed';

    update public.jm_vacancies
       set workers_found = v_found,
           status = case when v_found >= v_needed then 'closed' else status end
     where id = p_vacancy_id;
  end if;

  -- В JobToo один разговор на пару людей. Блокировка пары закрывает гонку,
  -- когда два разных отклика этой же пары становятся мэтчами одновременно.
  perform pg_advisory_xact_lock(hashtext(v_like.worker_id || ':' || v_like.employer_id));

  select c.id into v_chat_id
  from public.jm_chats c
  where c.worker_id = v_like.worker_id
    and c.employer_id = v_like.employer_id
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_chat_id is null then
    insert into public.jm_chats (
      id, vacancy_id, worker_id, employer_id,
      vac_title, company_name, unread_worker, unread_employer,
      created_at, is_locked
    ) values (
      p_chat_id, p_vacancy_id, v_like.worker_id, v_like.employer_id,
      coalesce(v_vac.title, ''), coalesce(v_vac.company, ''), 1, 1,
      now(), false
    );
    v_chat_id := p_chat_id;
    v_chat_created := true;
    v_repaired := not v_match_created;
  else
    update public.jm_chats
       set vacancy_id = p_vacancy_id,
           vac_title = coalesce(v_vac.title, ''),
           company_name = coalesce(v_vac.company, '')
     where id = v_chat_id;
  end if;

  -- Системные сообщения нужны только для нового мэтча либо для ремонта старого
  -- частичного состояния. Детерминированные id делают повтор запроса безопасным.
  if v_match_created or v_chat_created then
    v_date := case
      when coalesce(v_vac.date, '') ~ '^\d{4}-\d{2}-\d{2}$'
        then substr(v_vac.date, 9, 2) || '.' || substr(v_vac.date, 6, 2) || '.' || substr(v_vac.date, 1, 4)
      else coalesce(v_vac.date, '')
    end;
    v_when := concat_ws(', ',
      nullif(v_date, ''),
      nullif(concat_ws('–', nullif(v_vac.time_start, ''), nullif(v_vac.time_end, '')), '')
    );
    v_where := coalesce(nullif(v_vac.address, ''),
      case when nullif(v_vac.metro_station, '') is not null then 'м. ' || v_vac.metro_station else null end,
      '');

    v_card := 'Смена: ' || coalesce(v_vac.title, '');
    if v_when <> '' then v_card := v_card || E'\nКогда: ' || v_when; end if;
    if v_where <> '' then v_card := v_card || E'\nГде: ' || v_where; end if;

    insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
    values (
      'shift-match-card:' || p_vacancy_id || ':' || p_worker_id,
      v_chat_id, 'system', v_card, now()
    )
    on conflict (id) do nothing;

    insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
    values (
      'shift-match:' || p_vacancy_id || ':' || p_worker_id,
      v_chat_id, 'system',
      '🎉 У вас мэтч! Вы подошли друг другу. Познакомьтесь и обсудите детали!',
      now()
    )
    on conflict (id) do nothing;

    if v_chat_created then
      insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
      values (
        'chat-safety:' || v_chat_id,
        v_chat_id, 'system_safety',
        E'🔒 Рекомендуем не переводить общение в сторонние мессенджеры или почту, а продолжить его в чате JobToo: так у мошенников будет меньше шансов вас обмануть.\n\nГде бы вы ни общались — не сообщайте свой CVV-код, код из SMS и не вводите данные карты по ссылке.',
        now()
      )
      on conflict (id) do nothing;
    end if;
  end if;

  return query select v_chat_id, v_match_created, v_chat_created, v_repaired, v_vacancy_closed;
end;
$$;

revoke all on function public.jm_match_shift_atomic(text, text, text)
  from public, anon, authenticated;
grant execute on function public.jm_match_shift_atomic(text, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
