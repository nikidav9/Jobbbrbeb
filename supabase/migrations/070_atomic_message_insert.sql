-- Сообщение и unread-счётчик должны быть одной транзакцией.
--
-- Раньше dbInsertMessage записывал jm_messages, а приложение вторым HTTP-запросом
-- вызывало dbIncrementUnread. При обрыве между ними сообщение уже было в чате,
-- но badge получателя не рос. Кроме того, db.php сам генерировал id сообщения:
-- если клиент не получил ответ и proxy повторил запрос, повтор мог создать вторую
-- строку с тем же текстом.
--
-- Теперь id генерирует клиентская service-функция ОДИН раз на логическое
-- действие и передаёт его во все retry одного proxy-вызова. Повтор с тем же id
-- возвращает уже записанную строку и не увеличивает unread второй раз.

create or replace function public.jm_insert_message_atomic(
  p_message_id text,
  p_chat_id text,
  p_sender_id text,
  p_text text
)
returns table(
  message_id text,
  chat_id text,
  sender_id text,
  message_text text,
  created_at timestamptz,
  inserted boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chat public.jm_chats%rowtype;
  v_existing public.jm_messages%rowtype;
  v_created_at timestamptz;
begin
  if nullif(btrim(coalesce(p_message_id, '')), '') is null then
    raise exception 'message id is required';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null then
    raise exception 'chat id is required';
  end if;
  if nullif(btrim(coalesce(p_sender_id, '')), '') is null then
    raise exception 'sender id is required';
  end if;
  if p_text is null or p_text = '' then
    raise exception 'message text is required';
  end if;

  -- Одна строка чата сериализует одновременно пришедшие сообщения и делает
  -- increment unread настоящим +1, а не read-modify-write с потерянным update.
  select * into v_chat
  from public.jm_chats
  where id = p_chat_id
  for update;

  if not found then
    raise exception 'chat not found';
  end if;
  if p_sender_id is distinct from v_chat.worker_id
     and p_sender_id is distinct from v_chat.employer_id then
    raise exception 'sender is not a chat participant';
  end if;

  -- Retry того же логического действия. Не только не вставляем дубль, но и
  -- проверяем, что случайная коллизия id не может вернуть чужое сообщение.
  select * into v_existing
  from public.jm_messages
  where id = p_message_id;

  if found then
    if v_existing.chat_id is distinct from p_chat_id
       or v_existing.sender_id is distinct from p_sender_id
       or v_existing.text is distinct from p_text then
      raise exception 'message id collision';
    end if;
    return query select
      v_existing.id,
      v_existing.chat_id,
      v_existing.sender_id,
      v_existing.text,
      v_existing.created_at,
      false;
    return;
  end if;

  insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
  values (p_message_id, p_chat_id, p_sender_id, p_text, now())
  returning jm_messages.created_at into v_created_at;

  if p_sender_id = v_chat.worker_id then
    update public.jm_chats
       set unread_employer = coalesce(unread_employer, 0) + 1
     where id = p_chat_id;
  else
    update public.jm_chats
       set unread_worker = coalesce(unread_worker, 0) + 1
     where id = p_chat_id;
  end if;

  return query select
    p_message_id,
    p_chat_id,
    p_sender_id,
    p_text,
    v_created_at,
    true;
end;
$$;

revoke all on function public.jm_insert_message_atomic(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.jm_insert_message_atomic(text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
