-- IT-компании из сверки со списком Cofinder (решение владельца 26.09.2026:
-- «покрытие как у Cofinder, но своими сборщиками»). Сами вакансии берутся с
-- сайтов компаний (scripts/career-endpoints.json), у Cofinder — только
-- перечень названий, какие компании вообще стоит подключить.
--
-- Эти компании — IT целиком: в ленту идут все их вакансии, как у Яндекса.
-- Росатом, СИБУР, Deloitte и Simple Wine — смешанные работодатели, их в
-- списке нет: от них в ленту идёт только раздел it.
begin;

insert into public.jm_it_companies (company) values
  ('ЮMoney'), ('НСПК'), ('ГНИВЦ'), ('M2 Tech'), ('Macroscop'), ('Stepik'),
  ('Гараж 8'), ('Coral'), ('Индасофт'), ('Cloud Networks'), ('Адвантум'),
  ('Directum'), ('Effective Technologies'), ('Rush Agency'), ('PrideInBrains'),
  ('Хоулмонт'), ('SearchInform'), ('Лоция'), ('Галактика'), ('Траектория технологий')
on conflict (company) do nothing;

commit;
