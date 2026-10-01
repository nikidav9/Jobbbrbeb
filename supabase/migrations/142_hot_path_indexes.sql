-- Индексы горячих выборок (аудит 16, стресс-тест копии 01.10.2026).
--
-- 000_base_schema.sql снята с облака без индексов, поэтому на живой базе их
-- ровно столько, сколько в миграциях, — а на чатах, сообщениях и откликах
-- их не было. Каждый dbGetChats и dbGetMessages шёл полным проходом по всем
-- сообщениям. Замер на синтетике (400 тыс. сообщений): последние сообщения
-- чатов 69 → 1,2 мс, сообщения чата 22,7 → 0,9 мс, отклики 4 → 0,05 мс.
--
-- Без concurrently: migrate.sh подаёт файл целиком, а таблицы у нас малые
-- (десятки тысяч строк) — запись блокируется на доли секунды.
create index if not exists jm_messages_chat_created_idx
  on public.jm_messages (chat_id, created_at);
create index if not exists jm_chats_worker_created_idx
  on public.jm_chats (worker_id, created_at desc);
create index if not exists jm_chats_employer_created_idx
  on public.jm_chats (employer_id, created_at desc);
create index if not exists jm_perm_applications_worker_created_idx
  on public.jm_perm_applications (worker_id, created_at desc);
create index if not exists jm_perm_applications_employer_created_idx
  on public.jm_perm_applications (employer_id, created_at desc);
create index if not exists jm_perm_vacancies_employer_created_idx
  on public.jm_perm_vacancies (employer_id, created_at desc);
-- Уведомления человека всегда читаются по свежести: составной индекс
-- покрывает и прежний (user_id), который теперь лишний.
create index if not exists jm_notifications_user_created_idx
  on public.jm_notifications (user_id, created_at desc);
drop index if exists public.jm_notifications_user_id_idx;

-- Последнее сообщение каждого чата — для списка чатов (dbGetChats).
-- Прежде прокси забирал ВСЕ сообщения всех чатов человека, каждые 8 секунд,
-- и выбрасывал всё, кроме первого на чат. distinct on по индексу выше
-- берёт ровно по одной строке на чат.
create or replace function jm_last_messages(p_chat_ids text[])
returns setof jm_messages
language sql
stable
set search_path = public
as $$
    select distinct on (m.chat_id) m.*
    from jm_messages m
    where m.chat_id = any(p_chat_ids)
    order by m.chat_id, m.created_at desc
$$;
revoke all on function jm_last_messages(text[]) from public, anon, authenticated;
grant execute on function jm_last_messages(text[]) to service_role;
