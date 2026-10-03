-- Капча нажатиями (03.10.2026, решение владельца): галочка «я не робот» и
-- выбор картинок нельзя решить вводом слова. Воркер присылает снимок области
-- капчи (kind = 'tap'), человек нажимает на нужные места в приложении, ответ —
-- список точек в долях картинки; воркер повторяет нажатия в своём браузере.
-- Капчу решает только человек.
begin;

alter table public.jm_jupiter_captcha
    add column if not exists kind text not null default 'text';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'jm_jupiter_captcha_kind_check'
    ) then
        alter table public.jm_jupiter_captcha
            add constraint jm_jupiter_captcha_kind_check check (kind in ('text', 'tap'));
    end if;
end $$;

commit;
