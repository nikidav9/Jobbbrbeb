-- IT-компании, которые прошли только после доработки разбора (26.09.2026):
-- вакансии блоками на одной странице (html_blocks), данные Next.js
-- (__next_f), Strapi REST. IT целиком — продуктовые IT-компании и IT-услуги;
-- агентства (Палиндром, SETTERS, UPSIDE) и не-IT (SharpLase) — только раздел it.
begin;

insert into public.jm_it_companies (company) values
  ('NeuroCity'), ('Айти Новация'), ('Extyl'), ('Tilda Publishing'), ('SmartDec'), ('YoloPrice'), ('TalkBank'), ('Eduson'), ('Proscom')
on conflict (company) do nothing;

commit;
