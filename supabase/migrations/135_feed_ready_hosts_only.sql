-- Отклик в один свайп (решение владельца 28.09.2026, вариант «1»): в ленте
-- только вакансии сайтов, куда Юпитер отправляет отклик сам — без анкеты у
-- человека и на любом телефоне (на iPhone сайт не может заполнять чужие
-- анкеты, и «через телефон» там значило «всё вручную»).
--
-- jm_jupiter_ready_hosts — хосты боевой подачи (site_compat.live_ready):
-- засеяны флагом владельца, дальше воркер раз в час присылает полный список
-- (флаг владельца + свежая разведка) через jupiterRequeueSiteReady, и
-- db.php синхронизирует таблицу. Хост — как normalize_host воркера: нижний
-- регистр, без www., точное совпадение.
--
-- jm_ext_feed_pool получает p_ready_only (по умолчанию false — старые вызовы
-- как раньше). Заявки, которые миграция 133 положила в «Нужны вы»
-- (PHONE_FILL) на подключённых сайтах, возвращаются серверу.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction.
begin;

create table if not exists public.jm_jupiter_ready_hosts (
  host text primary key,
  updated_at timestamptz not null default now()
);
alter table public.jm_jupiter_ready_hosts enable row level security;
revoke all on public.jm_jupiter_ready_hosts from anon, authenticated;
grant all on public.jm_jupiter_ready_hosts to service_role;

insert into public.jm_jupiter_ready_hosts (host) values
  ('1c.ru'),
  ('agima.ru'),
  ('aviasales.ru'),
  ('bsl.dev'),
  ('career.astondevs.ru'),
  ('career.kokocgroup.ru'),
  ('careers.croc.ru'),
  ('careers.yadro.com'),
  ('centicore.ru'),
  ('cloud.ru'),
  ('dataru.ru'),
  ('garage-eight.com'),
  ('ispring.ru'),
  ('itglobal.com'),
  ('job.2gis.ru'),
  ('job.lamoda.ru'),
  ('kontur.ru'),
  ('maria-ra.ru'),
  ('navio.auto'),
  ('pro.macroscop.com'),
  ('rabota.cdek.ru'),
  ('rabota.lemanapro.ru'),
  ('rabota.perekrestok.ru'),
  ('rabota.sber.ru'),
  ('rdwcomp.ru'),
  ('redlab.dev'),
  ('selecty.ru'),
  ('trctech.ru'),
  ('usetech.ru'),
  ('x5.tech')
on conflict (host) do nothing;

create or replace function public.jm_url_host(p_url text)
returns text language sql immutable as $$
  select regexp_replace(lower(substring(coalesce(p_url, '') from '^[a-zA-Z]+://([^/:?#]+)')), '^www\.', '')
$$;

drop function if exists public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean);

create or replace function public.jm_ext_feed_pool(
  p_user text, p_per_company int default 30, p_sections text[] default null,
  p_it_only boolean default false, p_moscow_only boolean default false,
  p_hide_seen boolean default true, p_ready_only boolean default false
)
returns setof public.jm_ext_vacancies
language sql stable security definer set search_path = public as $$
  select v.*
    from public.jm_ext_vacancies v
    join (
      select c.id,
             row_number() over (partition by coalesce(c.company, '')
                                order by c.first_seen_at desc, c.id) as rn
        from public.jm_ext_vacancies c
       where c.active
         and (p_sections is null or c.section = any(p_sections))
         and (not p_it_only or c.section = 'it'
              or (exists (select 1 from public.jm_it_companies i where i.company = c.company)
                  and c.section not in ('warehouse', 'delivery', 'transport', 'retail',
                                        'food', 'production', 'service', 'medical')))
         and (not p_moscow_only or c.metro_station_norm is not null
              or coalesce(btrim(c.address), '') = ''
              or c.address ~* '([Мм]оскв|МОСКВ|[Mm]oscow|MOSCOW|[Зз]еленоград|ЗЕЛЕНОГРАД|[Уу]дал[её]н|УДАЛ[ЕЁ]Н|[Rr]emote|REMOTE|[Дд]истанц|ДИСТАНЦ)')
         and (not p_ready_only or exists (
               select 1 from public.jm_jupiter_ready_hosts h
                where h.host = public.jm_url_host(c.url)))
         and (p_user is null or not exists (
               select 1 from public.jm_ext_swipes s
                where s.user_id = p_user and s.vacancy_id = c.id
                  and (p_hide_seen or s.dir = 1)))
         and (p_user is null or not exists (
               select 1 from public.jm_jupiter_applications a
                where a.user_id = p_user and a.vacancy_url = c.url))
    ) r on r.id = v.id
   where r.rn <= greatest(1, least(p_per_company, 5000));
$$;
revoke all on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean, boolean) to service_role;


-- PHONE_FILL на подключённых сайтах — обратно серверу. Разрешение на
-- автоотправку — только тем, у кого поручение включено и не отозвано.
update public.jm_jupiter_applications a
   set state = 'queued',
       reason_code = null,
       not_before = null,
       submission_authorized_at = case
         when u.jupiter_live_enabled_at is not null then now() else null end,
       updated_at = now()
  from public.jm_users u
 where u.id = a.user_id
   and a.state = 'action_required'
   and a.reason_code = 'PHONE_FILL'
   and a.lease_owner is null
   and exists (select 1 from public.jm_jupiter_ready_hosts h
                where h.host = public.jm_url_host(a.vacancy_url));

commit;
