-- Создание мэтча по смене должно быть одной транзакцией.
--
-- Раньше dbCheckAndCreateMatch сначала ставил jm_likes.is_match=true, а уже
-- потом отдельными запросами искал/создавал чат и системные сообщения. Обрыв
-- между этими шагами оставлял настоящий мэтч без разговора. Кроме того, два
-- одновременных мэтча одной пары людей по разным сменам могли создать два чата.
--
-- Эта функция сериализует конкретный отклик блокировкой строки, а пару людей —
-- advisory-lock'ом. Мэтч, чат и обязательные системные сообщения коммитятся
-- вместе. Повтор после потерянного HTTP-ответа безопасен, а старое частичное
-- состояние «is_match=true, но чата нет» чинится при следующем вызове.

create or replace function public.jm_match_shift_atomic(
  p_vacancy_id text,
  p_worker_id text,
  p_chat_id text
)
returns table(
  chat_id text,
  matched boolean,
  chat_created boolean,
  repaired boolean
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
    return query select null::text, false, false, false;
    return;
  end if;

  -- Пока обе стороны не выбрали друг друга, создавать мэтч нечего.
  if coalesce(v_like.worker_liked, false) is not true
     or v_like.employer_liked is distinct from true then
    return query select null::text, false, false, false;
    return;
  end if;

  select * into v_vac
  from public.jm_vacancies
  where id = p_vacancy_id;

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

  return query select v_chat_id, v_match_created, v_chat_created, v_repaired;
end;
$$;

revoke all on function public.jm_match_shift_atomic(text, text, text)
  from public, anon, authenticated;
grant execute on function public.jm_match_shift_atomic(text, text, text)
  to service_role;

notify pgrst, 'reload schema';
