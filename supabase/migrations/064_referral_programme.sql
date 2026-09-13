-- Реферальная программа: кто кого привёл и что за это причитается.
--
-- Пункт 6 плана развития. Склад — среда с плотными связями, люди зовут
-- знакомых на смены и без нас; программа делает это видимым и оплачиваемым.
--
-- Вознаграждение привязано к ВЫХОДУ НА СМЕНУ, а не к отклику. Прямой урок
-- Jobr из разбора конкурентов: там платили за каждый свайп вправо, к
-- партнёрам полетели пустые отклики, партнёры отключили фиды.

-- Код приглашения. Случайный и из id не выводится: попав к третьему лицу, он
-- не рассказывает о владельце ничего. Обычная кнопка «поделиться вакансией»
-- остаётся обезличенной — это отдельное, осознанное действие.
alter table public.jm_users
  add column if not exists referral_code text,
  add column if not exists invited_by text references public.jm_users(id) on delete set null,
  add column if not exists invited_at timestamptz;

create unique index if not exists jm_users_referral_code_key
  on public.jm_users (referral_code) where referral_code is not null;

create index if not exists jm_users_invited_by_idx
  on public.jm_users (invited_by) where invited_by is not null;

-- Сам себя привести нельзя. Это первое, что сделает всякий, кто увидит
-- вознаграждение, и запрет должен стоять в базе, а не только в коде: в базу
-- пишут и миграции, и панель, и обработчик.
alter table public.jm_users
  drop constraint if exists jm_users_no_self_invite;
alter table public.jm_users
  add constraint jm_users_no_self_invite check (invited_by is null or invited_by <> id);

-- Начисления. Это журнал событий, а не счёт: строка означает «человек, которого
-- привели, отработал первую смену», а не «деньги ушли».
create table if not exists public.jm_referral_rewards (
  id            text primary key,
  inviter_id    text not null references public.jm_users(id) on delete cascade,
  invitee_id    text not null references public.jm_users(id) on delete cascade,
  like_id       text,
  -- pending — событие есть, цена ещё не назначена владельцем;
  -- approved — сумма проставлена; paid — выплачено; rejected — отклонено.
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'paid', 'rejected')),
  amount_rub    numeric,
  qualified_at  timestamptz not null default now(),
  paid_at       timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

-- Один приглашённый — одно начисление, навсегда. Платим за первую
-- отработанную смену, а не за каждую: иначе это доля с чужого заработка, и
-- стоимость программы перестаёт быть предсказуемой. Проверка в коде есть, но
-- гонку двух одновременных отметок об окончании смены остановит только база.
create unique index if not exists jm_referral_rewards_invitee_key
  on public.jm_referral_rewards (invitee_id);

create index if not exists jm_referral_rewards_inviter_idx
  on public.jm_referral_rewards (inviter_id);

alter table public.jm_referral_rewards
  drop constraint if exists jm_referral_rewards_no_self;
alter table public.jm_referral_rewards
  add constraint jm_referral_rewards_no_self check (inviter_id <> invitee_id);

-- Таблица служебная: читает и пишет её только php-proxy под service_role,
-- который ходит мимо RLS. Людям она не отдаётся ни строкой.
alter table public.jm_referral_rewards enable row level security;

notify pgrst, 'reload schema';
