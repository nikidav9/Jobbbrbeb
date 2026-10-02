-- Подсказки полей анкеты для телефонного автопилота (01.10.2026, решение
-- владельца: «непонятно, что заполнять, — сигнал серверу, разбираемся»).
-- Строка — одно поле одного сайта: подпись сайта (уже без данных человека),
-- ключ профиля, который в него подходит, и откуда ответ (gpt — YandexGPT,
-- manual — поправили мы, pending — модель не ответила, спросим снова).
-- key = null — поле не про данные профиля: такие и есть список «разобраться».
create table if not exists public.jm_jupiter_field_hints (
  host        text not null,
  sig         text not null,
  label       text not null default '',
  field_name  text not null default '',
  key         text,
  source      text not null default 'gpt' check (source in ('gpt', 'manual', 'pending')),
  updated_at  timestamptz not null default now(),
  primary key (host, sig)
);

alter table public.jm_jupiter_field_hints enable row level security;
revoke all on public.jm_jupiter_field_hints from anon, authenticated;
