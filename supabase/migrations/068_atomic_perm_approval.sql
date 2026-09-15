-- Одобрение отклика на постоянную вакансию — одна транзакция.
--
-- Раньше клиент сначала ставил status=approved, а вторым HTTP-запросом создавал
-- чат и первое сообщение директора. Обрыв между запросами оставлял человека
-- «одобренным», но без разговора. Повторное нажатие уже не всегда было доступно.
--
-- Блокируем сам отклик: повторные одобрения одной заявки сериализованы. Чаты
-- намеренно не получают новый UNIQUE — в живой истории могли остаться старые
-- дубли, и миграция не должна ради нового действия ломать весь deploy.

create or replace function public.jm_approve_perm_application(
  p_application_id text,
  p_employer_id text,
  p_chat_id text,
  p_message text
)
returns table(
  chat_id text,
  status_changed boolean,
  chat_created boolean,
  message_created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.jm_perm_applications%rowtype;
  v_chat_id text;
  v_title text := '';
  v_company text := '';
  v_status_changed boolean := false;
  v_chat_created boolean := false;
  v_message_created boolean := false;
  v_rows integer := 0;
begin
  if nullif(btrim(coalesce(p_application_id, '')), '') is null then
    raise exception 'application id is required';
  end if;
  if nullif(btrim(coalesce(p_employer_id, '')), '') is null then
    raise exception 'employer id is required';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null then
    raise exception 'chat id is required';
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then
    raise exception 'approval message is required';
  end if;
  if char_length(p_message) > 4000 then
    raise exception 'approval message is too long';
  end if;

  select * into v_app
  from public.jm_perm_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;
  if v_app.employer_id is distinct from p_employer_id then
    raise exception 'application owner mismatch';
  end if;
  if v_app.status not in ('pending', 'approved') then
    raise exception 'application cannot be approved from status %', v_app.status;
  end if;

  if v_app.status = 'pending' then
    update public.jm_perm_applications
       set status = 'approved'
     where id = v_app.id;
    v_status_changed := true;
  end if;

  -- JobToo исторически держит один разговор на пару людей. Берём уже
  -- существующий разговор независимо от того, по какой их вакансии он возник.
  select c.id into v_chat_id
  from public.jm_chats c
  where c.worker_id = v_app.worker_id
    and c.employer_id = v_app.employer_id
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_chat_id is null then
    select coalesce(v.title, ''), coalesce(v.company, '')
      into v_title, v_company
    from public.jm_perm_vacancies v
    where v.id = v_app.vacancy_id;

    insert into public.jm_chats (
      id, vacancy_id, worker_id, employer_id,
      vac_title, company_name, unread_worker, unread_employer,
      created_at, is_locked
    ) values (
      p_chat_id, v_app.vacancy_id, v_app.worker_id, v_app.employer_id,
      coalesce(v_title, ''), coalesce(v_company, ''), 0, 0,
      now(), false
    );
    v_chat_id := p_chat_id;
    v_chat_created := true;
  end if;

  -- При обычном переходе pending→approved сообщение обязательно. Если это
  -- повтор после потерянного HTTP-ответа, status уже approved и сообщение
  -- лежит в той же транзакции — второй раз его не пишем. Отдельно чиним
  -- старое частичное состояние «approved, но чата нет»: новый чат получает
  -- сообщение, иначе ремонт был бы снова наполовину.
  if v_status_changed or v_chat_created then
    insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
    values ('perm-approve:' || v_app.id, v_chat_id, v_app.employer_id, p_message, now())
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    v_message_created := v_rows > 0;

    if v_message_created then
      update public.jm_chats
         set unread_worker = coalesce(unread_worker, 0) + 1
       where id = v_chat_id;
    end if;
  end if;

  return query select v_chat_id, v_status_changed, v_chat_created, v_message_created;
end;
$$;

revoke all on function public.jm_approve_perm_application(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.jm_approve_perm_application(text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
