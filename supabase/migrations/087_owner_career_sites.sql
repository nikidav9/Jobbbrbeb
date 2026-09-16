-- Все карьерные сайты из исходного списка владельца JobToo.
--
-- 62 компании, 68 отдельных разделов. У Самоката, Спортмастера, Золотого
-- Яблока, Сбера, МегаФона и Яндекса сохранены оба раздела: это не дубли,
-- а разные витрины вакансий.
--
-- Выносим их в отдельный career-источник, чтобы медленный/закрытый сайт из
-- большого списка не задерживал уже работающие API/парсеры источника `career`.
-- career.php умеет проходить pages по одной, а ingest сохраняет checkpoint.
--
-- Здесь только прямые страницы работодателей. Никаких hh.ru/SuperJob/Avito.
-- Для Ярче! хранится ASCII/punycode-адрес: FILTER_VALIDATE_URL на сервере
-- намеренно не принимает Unicode-домен до безопасного DNS-разрешения.

insert into public.jm_ext_sources (
  id, name, url, enabled, period_min, environment,
  connector_kind, integration_mode, connector_config
) values (
  'career_owner',
  'Карьерные сайты — список владельца',
  'https://jobtoo.ru/api/career.php?source=career_owner',
  true,
  360,
  'production',
  'career',
  'redirect',
  jsonb_build_object(
    'pages',
    $pages$[
  "https://rabota5ka.ru/vacancies",
  "https://rabota.perekrestok.ru/vacancies",
  "https://rabota.magnit.ru",
  "https://career.lenta.com",
  "https://vkusvill.ru/job/vacancys",
  "https://rabota.metro-cc.ru/vacancies/store",
  "https://www.okmarket.ru/career/vacancies",
  "https://rabota.globus.ru",
  "https://krasnoeibeloe.ru/job",
  "https://fix-price.com/work/store",
  "https://chizhik.club/rabota",
  "https://dixy.ru/group/career/vacancy",
  "https://career.monetka.ru",
  "https://myspar.ru/career",
  "https://www.slata.ru/vacancy",
  "https://www.maria-ra.ru/karera-v-seti/vakansii",
  "https://xn--80aacr7bjeo1cwe.xn--p1ai",
  "https://career.rwb.ru/vacancies",
  "https://career.ozon.ru/vacancy",
  "https://job.lamoda.ru/vacancies",
  "https://vacancy.samokat.ru",
  "https://job.sportmaster.ru",
  "https://career.mvideoeldorado.ru/vacancies",
  "https://www.dns-shop.ru/jobs",
  "https://job.hoff.ru",
  "https://rabota.lemanapro.ru/vacancies",
  "https://petrovichjob.ru",
  "https://jobs.detmir.ru",
  "https://job.goldapple.ru",
  "https://rivegauche.ru/work",
  "https://rabota.r-ulybka.ru",
  "https://rabotavpodrygke.ru",
  "https://kari.com/job",
  "https://lookbook.gloria-jeans.ru",
  "https://befree.ru/job",
  "https://henderson.ru/company/vacancies",
  "https://rabota.cdek.ru/vacancies",
  "https://job.dellin.ru",
  "https://hr.pecom.ru",
  "https://dpd.ru/vacancy",
  "https://www.pochta.ru/vacancy-list",
  "https://team.rzd.ru/career/vacancies",
  "https://vacancy.aeroflot.ru",
  "https://job.svo.su",
  "https://vacancies.cherkizovo.com/vacancies",
  "https://career.severstal.com/vacancies",
  "https://career.sibur.ru/vacancies",
  "https://career.baltika.ru",
  "https://career.nornickel.ru/vacancies",
  "https://www.phosagro.ru/career-education/vacancies",
  "https://www.rusal.ru/career/vacancies",
  "https://rabotavdodo.ru",
  "https://rabotaitochka.ru",
  "https://rostics.ru/ru/career",
  "https://burgerkingrus.ru/rabota",
  "https://rabota.teremok.ru/vacancies",
  "https://rabota.coffeemania.ru",
  "https://regions.shoko.ru/career",
  "https://azimuthotels.com/ru/info/career",
  "https://rabota.sber.ru",
  "https://job.megafon.ru",
  "https://yandex.ru/jobs",
  "https://yandex.ru/jobs/vacancies",
  "https://job.goldapple.ru/search/all",
  "https://rabota.sber.ru/search",
  "https://vacancy.samokat.ru/vacancies-business",
  "https://job.megafon.ru/vacancy/all/any",
  "https://job.sportmaster.ru/vacancies"
]$pages$::jsonb
  )
)
on conflict (id) do update
set name = excluded.name,
    url = excluded.url,
    enabled = true,
    period_min = excluded.period_min,
    environment = excluded.environment,
    connector_kind = excluded.connector_kind,
    integration_mode = excluded.integration_mode,
    connector_config = excluded.connector_config;

notify pgrst, 'reload schema';
