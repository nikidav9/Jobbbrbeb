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

const IN = process.argv[2] || 'career-verified.json';
const SOURCE = process.env.MIGRATION_SOURCE || 'career';

const rows = JSON.parse(fs.readFileSync(IN, 'utf8')).filter(r => r.ok);
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

const guard = endpoints[0].url;
console.log(`-- Новые карьерные источники, подтверждённые проверкой из
-- scripts/career-endpoint-verify.mjs: адрес отдаёт список обычным запросом,
-- ссылка на вакансию открывается, выдуманный адрес ту же вакансию не
-- показывает. Компаний: ${rows.length}.
--
-- Правка точечная: дописываем в конец endpoints, настройку целиком не
-- переписываем — иначе потеряется то, что добавила соседняя миграция.

begin;

update public.jm_ext_sources
   set connector_config = jsonb_set(
         connector_config,
         '{endpoints}',
         (connector_config->'endpoints') || ${jsonbLiteral(endpoints)})
 where id = ${sqlString(SOURCE)}
   and jsonb_typeof(connector_config->'endpoints') = 'array'
   -- Повторный запуск миграции не должен задваивать источники.
   and not exists (
     select 1 from jsonb_array_elements(connector_config->'endpoints') e
     where e->>'url' = ${sqlString(guard)}
   );

commit;

notify pgrst, 'reload schema';`);
