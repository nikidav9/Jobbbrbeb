-- Private per-candidate inbound addresses and messages. The domain's catch-all
-- forwards unrecognised recipients to a single Timeweb mailbox.
create table if not exists public.jm_jupiter_mailboxes (
  user_id text primary key references public.jm_users(id) on delete cascade,
  address text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.jm_jupiter_emails (
  id text primary key,
  user_id text not null references public.jm_users(id) on delete cascade,
  mailbox_address text not null,
  imap_uid text not null unique,
  sender text not null,
  subject text not null default '',
  body text not null default '',
  received_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists jm_jupiter_emails_inbox
  on public.jm_jupiter_emails(user_id, received_at desc);

alter table public.jm_jupiter_mailboxes enable row level security;
alter table public.jm_jupiter_emails enable row level security;
revoke all on public.jm_jupiter_mailboxes from anon, authenticated;
revoke all on public.jm_jupiter_emails from anon, authenticated;

-- Accounts are anonymised, not physically removed, by jm_delete_account.
-- Clear both the alias and the stored correspondence at the same time.
create or replace function public.jm_jupiter_purge_mail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_blocked is true and old.is_blocked is distinct from true
     and new.first_name = 'Удалённый' then
    delete from jm_jupiter_emails where user_id = new.id;
    delete from jm_jupiter_mailboxes where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.jm_jupiter_purge_mail() from public, anon, authenticated;
drop trigger if exists jm_jupiter_purge_mail_on_deletion on public.jm_users;
create trigger jm_jupiter_purge_mail_on_deletion after update on public.jm_users
  for each row execute function public.jm_jupiter_purge_mail();
