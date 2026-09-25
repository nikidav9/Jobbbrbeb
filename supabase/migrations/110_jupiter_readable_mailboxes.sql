-- Читаемые адреса «Почты JobToo»: ivan.petrov@jobtoo.ru вместо u-<токен>.
--
-- Адрес выдаёт php-proxy/db.php (jt_jupiter_mailbox): имя.фамилия
-- латиницей, при повторе — цифра. Здесь только то, что нужно базе.

-- Адреса удалённых аккаунтов не выдаются повторно: иначе новый «Иван
-- Петров» получал бы ответы работодателей прежнему.
create table if not exists public.jm_jupiter_retired_addresses (
  address text primary key,
  retired_at timestamptz not null default now()
);
alter table public.jm_jupiter_retired_addresses enable row level security;
revoke all on public.jm_jupiter_retired_addresses from anon, authenticated;

create or replace function public.jm_jupiter_purge_mail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_blocked is true and old.is_blocked is distinct from true
     and new.first_name = 'Удалённый' then
    insert into jm_jupiter_retired_addresses(address)
      select address from jm_jupiter_mailboxes where user_id = new.id
      on conflict (address) do nothing;
    delete from jm_jupiter_emails where user_id = new.id;
    delete from jm_jupiter_mailboxes where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.jm_jupiter_purge_mail() from public, anon, authenticated;

-- Старые случайные адреса убираются по решению владельца (25.09.2026):
-- выдано их было единицы. Новый адрес создастся при первом обращении.
-- Уже полученные письма остаются у своих владельцев (jm_jupiter_emails
-- держит user_id, а не ссылку на ящик).
delete from public.jm_jupiter_mailboxes where address like 'u-%@jobtoo.ru';
