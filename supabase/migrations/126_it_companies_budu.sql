-- IT-компании из сверки с каталогом budu.jobs (решение владельца 26.09.2026).
-- У budu взяты только названия и сайты; вакансии берутся с сайтов самих
-- компаний (scripts/career-endpoints.json).
--
-- IT целиком — продуктовые IT-компании и IT-услуги: в ленту идут все их
-- вакансии. Digital-агентства и прочие компании каталога сюда не входят — от
-- них в ленту идёт только раздел it.
begin;

insert into public.jm_it_companies (company) values
  ('Туту'), ('Информзащита'), ('Wunder Fund')
on conflict (company) do nothing;

commit;
