-- IT-компании второй волны разведки (решение владельца 26.09.2026: российские
-- IT-работодатели сверх списка Cofinder). Вакансии — с сайтов самих компаний
-- (scripts/career-endpoints.json), в ленту идут все их вакансии.
begin;

insert into public.jm_it_companies (company) values
  ('Доктор Веб'), ('Бастион'), ('Innostage'), ('Перспективный мониторинг'),
  ('Норси-Транс'), ('OneTwoTrip'), ('Flowwow'), ('YCLIENTS'), ('Tripster')
on conflict (company) do nothing;

commit;
