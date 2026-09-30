-- Вопросы от работодателей (решение владельца 30.09.2026). Юпитер упёрся в
-- анкету, которой нужен ответ, которого нет в профиле: он кладёт вопросы
-- сюда, человек отвечает в приложении, отклик уходит сам.
--
-- jm_jupiter_questions — вопросы конкретного отклика. Ответ на вопрос «под
-- вакансию» живёт только здесь. question_key — смысл подписи поля
-- (jupiter/questions.py), по нему ответ находится при повторном заходе.
--
-- jm_jupiter_answers — банк ответов человека на вопросы-факты (Telegram, дата
-- выхода, зарплата): подставляются сами на других сайтах. Особые категории
-- 152-ФЗ (здоровье, судимость) сюда не попадают: Юпитер их вопросами не задаёт.
begin;

create table if not exists public.jm_jupiter_questions (
    id             text primary key default gen_random_uuid()::text,
    application_id text not null references public.jm_jupiter_applications(id) on delete cascade,
    user_id        text not null,
    question_key   text not null,
    question_text  text not null,
    field_type     text not null default 'text',
    kind           text not null default 'vacancy' check (kind in ('fact', 'vacancy')),
    options        jsonb not null default '[]'::jsonb,
    answer         text,
    status         text not null default 'open'
                   check (status in ('open', 'answered', 'skipped')),
    created_at     timestamptz not null default now(),
    answered_at    timestamptz,
    unique (application_id, question_key)
);
create index if not exists jm_jupiter_questions_user
    on public.jm_jupiter_questions (user_id, status, created_at desc);

create table if not exists public.jm_jupiter_answers (
    user_id       text not null,
    question_key  text not null,
    question_text text not null,
    answer        text not null,
    updated_at    timestamptz not null default now(),
    primary key (user_id, question_key)
);

alter table public.jm_jupiter_questions enable row level security;
alter table public.jm_jupiter_answers enable row level security;
revoke all on public.jm_jupiter_questions from anon, authenticated;
revoke all on public.jm_jupiter_answers from anon, authenticated;
grant all on public.jm_jupiter_questions to service_role;
grant all on public.jm_jupiter_answers to service_role;

commit;
