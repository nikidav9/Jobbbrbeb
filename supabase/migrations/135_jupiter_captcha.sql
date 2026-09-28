-- Капча человеку: воркер Jupiter упёрся в картинку-капчу, кладёт её сюда,
-- человек вводит слово в приложении, воркер забирает ответ. Капча не
-- обходится — её решает владелец отклика.
--
-- Картинка лежит base64-текстом (до 200 КБ, проверяет db.php). Строка живёт
-- 10 минут: просроченную ответом не принять.
begin;

create table if not exists public.jm_jupiter_captcha (
    id             text primary key default gen_random_uuid()::text,
    application_id text not null references public.jm_jupiter_applications(id) on delete cascade,
    user_id        text not null,
    image_png      text not null,
    status         text not null default 'pending'
                   check (status in ('pending', 'answered', 'expired', 'solved', 'failed')),
    answer         text,
    created_at     timestamptz not null default now(),
    expires_at     timestamptz not null default now() + interval '10 minutes',
    answered_at    timestamptz
);
create index if not exists jm_jupiter_captcha_app
    on public.jm_jupiter_captcha (application_id, created_at desc);

alter table public.jm_jupiter_captcha enable row level security;
revoke all on public.jm_jupiter_captcha from anon, authenticated;
grant all on public.jm_jupiter_captcha to service_role;

commit;
