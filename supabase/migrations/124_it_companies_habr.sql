-- IT-компании из сверки с Хабр Карьерой (решение владельца 26.09.2026).
-- У Хабра взяты только названия; вакансии берутся с сайтов самих компаний
-- (scripts/career-endpoints.json). IT целиком — продуктовые IT-компании и
-- IT-услуги: в ленту идут все их вакансии.
begin;

insert into public.jm_it_companies (company) values
  ('Айтуби'), ('БФТ-Холдинг'), ('Синимекс'), ('Поехали')
on conflict (company) do nothing;

commit;
