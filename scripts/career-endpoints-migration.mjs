#!/usr/bin/env node
/**
 * Из подтверждённых находок — миграция, дописывающая endpoints источнику.
 *
 * Руками такой JSON не собрать: после хорошего прогона подтверждается
 * несколько десятков компаний, и каждая ошибка в имени поля — это источник,
 * который молча принесёт мусор. Поэтому SQL печатает машина, а человек читает
 * результат.
 *
 * Правка ТОЧЕЧНАЯ, как в 089_mvideo_avito: дописываем элементы в конец
 * endpoints и не переписываем настройку целиком. Каждая перезапись всего JSON
 * — шанс потерять то, что добавила соседняя миграция.
 *
 * Запуск: node scripts/career-endpoints-migration.mjs verified.json > 0NN_x.sql
 */
import fs from 'node:fs';
import process from 'node:process';
import { companyName, jsonbLiteral, sqlString } from './career-sql-lib.mjs';
import { endpointWarning, vacancyLinkPath } from './career-discover-lib.mjs';

const IN = process.argv[2] || 'career-verified.json';
const SOURCE = process.env.MIGRATION_SOURCE || 'career';

// Подтверждённая ссылка — ещё не вакансия. Проверялка смотрит, что адрес
// открывается, но раздел «Услуги» открывается ничуть не хуже. Поэтому у
// html_links отдельно смотрим сам путь: на живом прогоне иначе прошли бы
// `/uslugi/`, `/comparisons/` и `/wp-content/uploads/2026/04/`.
const rejected = [];
const narrowedNotes = [];
const rows = JSON.parse(fs.readFileSync(IN, 'utf8')).filter(r => {
  if (!r.ok) return false;
  const e = r.connector_config?.endpoints?.[0];
  if (e?.mode === 'html_links' && !vacancyLinkPath(e.map?.link_path || '')) {
    rejected.push(`${r.name} — ${e.map?.link_path}`);
    return false;
  }
  // Параметры в адресе НЕ повод отказать. Первая версия отказывала — и
  // выбрасывала METRO с 307 вакансиями и Перекрёсток: у них `objtype`,
  // `linesPerPage` и `portals[0]` не сужают выдачу, а требуются самим API.
  // Отличить обязательный параметр от фильтра по самому адресу нельзя, поэтому
  // просто показываем человеку и берём источник.
  const narrowed = endpointWarning(e?.url || '');
  if (narrowed) narrowedNotes.push(`${r.name} — ${narrowed}`);
  return true;
});
if (rejected.length) {
  console.error(`Отброшено по пути ссылки: ${rejected.length}`);
  for (const line of rejected) console.error(`  ${line}`);
}
if (narrowedNotes.length) {
  console.error(`\nВзято, но посмотрите глазами — в адресе есть параметры: ${narrowedNotes.length}`);
  for (const line of narrowedNotes) console.error(`  ${line}`);
}
if (!rows.length) {
  console.error('нечего добавлять: ни одна находка не подтвердилась');
  process.exit(1);
}

// Компания в карточке обязательна: без неё вакансия попадёт в ленту без
// работодателя, а фильтр «Компания» её не покажет. Имя берём из списка целей,
// а не из ответа сайта: в ответах оно бывает пустым или служебным.
const endpoints = rows.map(r => {
  const e = { ...r.connector_config.endpoints[0] };
  e.map = { ...e.map, company_const: companyName(e.map?.company_const || r.name) };
  return e;
});

// Внутри пачки один и тот же адрес встречается: у части компаний два раздела
// приводят к одному и тому же API.
const unique = [];
const seen = new Set();
for (const e of endpoints) {
  if (seen.has(e.url)) continue;
  seen.add(e.url);
  unique.push(e);
}

console.log(`-- Новые карьерные источники, подтверждённые проверкой из
-- scripts/career-endpoint-verify.mjs: адрес отдаёт список обычным запросом,
-- ссылка на вакансию открывается, выдуманный адрес ту же вакансию не
-- показывает. Адресов: ${unique.length}.
--
-- Правка точечная: дописываем в конец endpoints, настройку целиком не
-- переписываем — иначе потеряется то, что добавила соседняя миграция.
--
-- Повтор невозможен по КАЖДОМУ адресу, а не по одному сторожевому: часть
-- этих источников уже может стоять в настройке, и проверка «есть ли первый»
-- либо пропустила бы всю пачку, либо задвоила бы половину.

begin;

update public.jm_ext_sources s
   set connector_config = jsonb_set(
         s.connector_config,
         '{endpoints}',
         (s.connector_config->'endpoints') || (
           select coalesce(jsonb_agg(c.value order by c.ord), '[]'::jsonb)
             from jsonb_array_elements(${jsonbLiteral(unique)}) with ordinality as c(value, ord)
            where not exists (
              select 1
                from jsonb_array_elements(s.connector_config->'endpoints') e
               where e->>'url' = c.value->>'url'
            )
         ))
 where s.id = ${sqlString(SOURCE)}
   and jsonb_typeof(s.connector_config->'endpoints') = 'array';

commit;

notify pgrst, 'reload schema';`);
