/**
 * Печать конфигурации источника в SQL.
 *
 * Эти функции пишут миграцию, которую потом накатывают на production-базу.
 * Ошибка здесь не падает — она записывает в настройку не то, и источник
 * молча приносит мусор или ничего.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { companyName, jsonbLiteral, sqlString } from '../scripts/career-sql-lib.mjs';

test('одинарная кавычка в названии компании не рвёт SQL', () => {
  // «О'КЕЙ» есть в нашем списке компаний. Без удвоения кавычки миграция
  // обрывается посреди строки — и это в лучшем случае.
  assert.equal(sqlString("О'КЕЙ"), "'О''КЕЙ'");
});

test('значения печатаются как текст, а не как голая подстановка', () => {
  // to_jsonb(...::text) нужен, чтобы `123` в названии осталось строкой, а не
  // стало числом: коннектор сравнивает поля как строки.
  assert.equal(jsonbLiteral('1С'), "to_jsonb('1С'::text)");
});

test('числа и логические значения не заворачиваются в текст', () => {
  assert.equal(jsonbLiteral(8), '8::jsonb');
  assert.equal(jsonbLiteral(true), 'true::jsonb');
});

test('вложенный объект печатается объектом, а не строкой', () => {
  assert.equal(
    jsonbLiteral({ url: 'https://x.ru', map: { link_path: '/vacancy/' } }),
    "jsonb_build_object('url', to_jsonb('https://x.ru'::text), "
    + "'map', jsonb_build_object('link_path', to_jsonb('/vacancy/'::text)))",
  );
});

test('массив печатается массивом', () => {
  assert.equal(jsonbLiteral([1, 'a']), "jsonb_build_array(1::jsonb, to_jsonb('a'::text))");
});

test('пустой объект остаётся пустым объектом', () => {
  // jsonb_build_object() без аргументов — синтаксическая ошибка в Postgres.
  assert.equal(jsonbLiteral({}), "'{}'::jsonb");
});

test('пометка раздела не уезжает в название компании', () => {
  // В списке целей у шести компаний по два раздела: «Золотое Яблоко · /» и
  // «Золотое Яблоко · /search/all». Хвост — наша пометка, а не имя. Без
  // очистки в фильтре «Компания» одна компания стала бы двумя.
  assert.equal(companyName('Золотое Яблоко · /search/all'), 'Золотое Яблоко');
  assert.equal(companyName('Яндекс · /jobs'), 'Яндекс');
  assert.equal(companyName('Wildberries / РВБ'), 'Wildberries / РВБ');
  assert.equal(companyName(''), '');
});
