-- Ленту можно сузить до раздела, и свайпать можно и свои вакансии JobToo.
--
-- Решение владельца 25.09.2026: лента как у Sorce. Шестерёнка в шапке
-- пускает шторку с разделами — jm_ext_feed_pool учится фильтровать по ним,
-- а не отдавать все компании разом. Раньше свайп по-настоящему хранился
-- только для карьерных вакансий (jm_ext_swipes, миграция 112); у своих смахнутая
-- влево вакансия после перезапуска возвращалась. jm_perm_swipes закрывает то
-- же самое для jm_perm_vacancies.
--
-- Явные begin/commit: infra/migrate.sh гоняет psql БЕЗ --single-transaction,
-- каждый оператор фиксируется сам по себе. Без обёртки падение посередине
-- оставило бы базу наполовину применённой.
begin;

-- drop, а не create or replace: новый третий аргумент иначе завёл бы
-- перегрузку (text, int) рядом с (text, int, text[]), и обе жили бы в базе.
drop function if exists public.jm_ext_feed_pool(text, int);

create or replace function public.jm_ext_feed_pool(
  p_user text, p_per_company int default 30, p_sections text[] default null
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
         and (p_user is null or not exists (
               select 1 from public.jm_ext_swipes s
                where s.user_id = p_user and s.vacancy_id = c.id))
         and (p_user is null or not exists (
               select 1 from public.jm_jupiter_applications a
                where a.user_id = p_user and a.vacancy_url = c.url))
    ) r on r.id = v.id
   where r.rn <= greatest(1, least(p_per_company, 200));
$$;
revoke all on function public.jm_ext_feed_pool(text, int, text[]) from public, anon, authenticated;
-- revoke from public отнимает право и у service_role, через которую ходит
-- db.php (урок миграции 108: без этой строки каждый вызов ленты — HTTP 500).
grant execute on function public.jm_ext_feed_pool(text, int, text[]) to service_role;

-- Свайпы по своим вакансиям JobToo: чтобы смахнутая влево не возвращалась
-- после перезапуска (решение владельца 25.09.2026), как уже сделано для
-- карьерных вакансий в jm_ext_swipes.
create table if not exists public.jm_perm_swipes (
  user_id text not null references public.jm_users(id) on delete cascade,
  vacancy_id text not null references public.jm_perm_vacancies(id) on delete cascade,
  dir smallint not null check (dir in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, vacancy_id)
);
create index if not exists jm_perm_swipes_recent on public.jm_perm_swipes (user_id, created_at desc);

alter table public.jm_perm_swipes enable row level security;
revoke all on public.jm_perm_swipes from anon, authenticated;
grant all on public.jm_perm_swipes to service_role;

-- Свайпы — поведение конкретного человека, то есть персональные данные.
-- jm_delete_account (миграция 032) аккаунт не удаляет, а обезличивает, поэтому
-- on delete cascade здесь не сработает никогда. Стираем явно, тем же условием,
-- что почта Юпитера в миграции 107. Заодно закрываем ту же дыру у
-- jm_ext_swipes из миграции 112.
create or replace function public.jm_purge_swipes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_blocked is true and old.is_blocked is distinct from true
     and new.first_name = 'Удалённый' then
    delete from jm_perm_swipes where user_id = new.id;
    delete from jm_ext_swipes where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.jm_purge_swipes() from public, anon, authenticated;
drop trigger if exists jm_purge_swipes_on_deletion on public.jm_users;
create trigger jm_purge_swipes_on_deletion after update on public.jm_users
  for each row execute function public.jm_purge_swipes();

commit;
