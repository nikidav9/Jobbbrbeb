-- Один бренд не должен распадаться на разные компании из-за юрлица,
-- регистра, кавычек или старого product label. Каноническое имя во всём
-- продукте теперь «Лавка»: профили работодателей, смены, постоянные вакансии
-- и сохранённое в чатах имя компании.
begin;

create or replace function public.jm_canonical_company_name(p_company text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select case
    when p_company is null then null
    when regexp_replace(
           lower(btrim(p_company)),
           $rx$[[:space:]"'«»().]+$rx$,
           '',
           'g'
         ) in ('лавка', 'яндекславка', 'ооолавка', 'ооояндекславка')
      then 'Лавка'
    else btrim(p_company)
  end;
$fn$;

update public.jm_users
   set company = public.jm_canonical_company_name(company)
 where company is distinct from public.jm_canonical_company_name(company);

update public.jm_vacancies
   set company = public.jm_canonical_company_name(company)
 where company is distinct from public.jm_canonical_company_name(company);

update public.jm_perm_vacancies
   set company = public.jm_canonical_company_name(company)
 where company is distinct from public.jm_canonical_company_name(company);

update public.jm_chats
   set company_name = public.jm_canonical_company_name(company_name)
 where company_name is distinct from public.jm_canonical_company_name(company_name);

create or replace function public.jm_canonical_company_trg()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.company := public.jm_canonical_company_name(new.company);
  return new;
end;
$fn$;

drop trigger if exists jm_users_canonical_company on public.jm_users;
create trigger jm_users_canonical_company
before insert or update of company on public.jm_users
for each row execute function public.jm_canonical_company_trg();

drop trigger if exists jm_vacancies_canonical_company on public.jm_vacancies;
create trigger jm_vacancies_canonical_company
before insert or update of company on public.jm_vacancies
for each row execute function public.jm_canonical_company_trg();

drop trigger if exists jm_perm_vacancies_canonical_company on public.jm_perm_vacancies;
create trigger jm_perm_vacancies_canonical_company
before insert or update of company on public.jm_perm_vacancies
for each row execute function public.jm_canonical_company_trg();

create or replace function public.jm_canonical_chat_company_trg()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.company_name := public.jm_canonical_company_name(new.company_name);
  return new;
end;
$fn$;

drop trigger if exists jm_chats_canonical_company on public.jm_chats;
create trigger jm_chats_canonical_company
before insert or update of company_name on public.jm_chats
for each row execute function public.jm_canonical_chat_company_trg();

commit;

notify pgrst, 'reload schema';
