-- Вход по почте с кодом из письма.
--
-- Решение владельца 25.09.2026: регистрация по телефону убирается, вход и
-- восстановление пароля — по почте с кодом. Телефон остаётся необязательным
-- «телефоном для связи» (его видит другая сторона после одобрения отклика),
-- у старых аккаунтов он по-прежнему годится для входа, пока они не
-- укажут почту.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

-- Почта для входа. Хранится уже приведённой (trim + lower) — это делает
-- db.php, — поэтому уникальность по самому полю, без lower() в индексе.
alter table public.jm_users add column if not exists email text;
alter table public.jm_users add column if not exists email_verified_at timestamptz;
create unique index if not exists jm_users_email_uniq
  on public.jm_users (email) where email is not null;

-- Телефон больше не обязателен: у новых людей его может не быть вовсе.
-- Уникальный индекс jm_users_phone_uniq (миграция 062) уже частичный —
-- пустые и null в нём не участвуют.
alter table public.jm_users alter column phone drop not null;

-- Коды из писем. Храним не код, а его HMAC: утечка таблицы не даёт войти.
-- purpose: register — новый аккаунт; attach — почта к старому аккаунту по
-- телефону; reset — восстановление пароля.
create table if not exists public.jm_auth_codes (
  id          text primary key,
  email       text not null,
  purpose     text not null check (purpose in ('register', 'attach', 'reset')),
  user_id     text references public.jm_users(id) on delete cascade,
  code_hash   text not null,
  attempts    smallint not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists jm_auth_codes_lookup
  on public.jm_auth_codes (email, purpose, created_at desc);

alter table public.jm_auth_codes enable row level security;
revoke all on public.jm_auth_codes from anon, authenticated;
grant all on public.jm_auth_codes to service_role;

-- Удаление аккаунта (jm_delete_account, миграция 032) строку не стирает, а
-- обезличивает: телефон меняется на метку, пароль — на null. Почта — такие
-- же персональные данные и ключ для входа, её стираем тем же условием, что
-- свайпы в миграции 115, и заодно её неиспользованные коды.
create or replace function public.jm_purge_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_blocked is true and old.is_blocked is distinct from true
     and new.first_name = 'Удалённый' then
    if old.email is not null then
      delete from jm_auth_codes where email = old.email;
    end if;
    new.email := null;
    new.email_verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.jm_purge_email() from public, anon, authenticated;
drop trigger if exists jm_purge_email_on_deletion on public.jm_users;
create trigger jm_purge_email_on_deletion before update on public.jm_users
  for each row execute function public.jm_purge_email();

commit;
