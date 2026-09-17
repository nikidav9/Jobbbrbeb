import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayLabel, dayShort, groupByDay } from '../services/dayGroups.ts';

// Границы суток ломаются молча и в одну сторону: вечернее событие уезжает в
// завтрашнюю группу, и заметить это можно только вечером.

const NOW = new Date(2026, 8, 17, 15, 0, 0); // 17 сентября 2026, местное

test('ключ дня берётся по местному времени, а не по UTC', () => {
  // Полдвенадцатого ночи по местному — это ещё сегодня, хотя в UTC может быть
  // уже завтра. Ровно на этом и горят, когда пишут toISOString().slice(0,10).
  assert.equal(dayKey(new Date(2026, 8, 17, 23, 30).toISOString()), '2026-09-17');
  assert.equal(dayKey(new Date(2026, 8, 18, 0, 10).toISOString()), '2026-09-18');
});

test('непригодная дата даёт пустой ключ, а не сегодняшний', () => {
  assert.equal(dayKey(null), '');
  assert.equal(dayKey(undefined), '');
  assert.equal(dayKey(''), '');
  assert.equal(dayKey('не дата'), '');
});

test('заголовки групп', () => {
  assert.equal(dayLabel('2026-09-17', NOW), 'СЕГОДНЯ');
  assert.equal(dayLabel('2026-09-16', NOW), 'ВЧЕРА');
  assert.equal(dayLabel('2026-09-08', NOW), '8 СЕНТЯБРЯ');
  assert.equal(dayLabel('', NOW), 'РАНЬШЕ');
});

test('короткая дата для правого края строки', () => {
  assert.equal(dayShort('2026-09-17', NOW), 'сегодня');
  assert.equal(dayShort('2026-09-16', NOW), 'вчера');
  assert.equal(dayShort('2026-09-08', NOW), '8 сен');
  assert.equal(dayShort('', NOW), '');
});

test('«вчера» переживает границу месяца', () => {
  const first = new Date(2026, 9, 1, 12, 0, 0); // 1 октября
  assert.equal(dayLabel('2026-09-30', first), 'ВЧЕРА');
  assert.equal(dayShort('2026-09-30', first), 'вчера');
});

test('группировка сохраняет порядок и не сливает разные дни', () => {
  const items = [
    { id: 'a', at: new Date(2026, 8, 17, 10).toISOString() },
    { id: 'b', at: new Date(2026, 8, 17, 9).toISOString() },
    { id: 'c', at: new Date(2026, 8, 16, 20).toISOString() },
    { id: 'd', at: new Date(2026, 8, 8, 12).toISOString() },
  ];
  const g = groupByDay(items, i => i.at, NOW);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map(x => x.label), ['СЕГОДНЯ', 'ВЧЕРА', '8 СЕНТЯБРЯ']);
  assert.deepEqual(g[0].items.map(i => i.id), ['a', 'b']);
});

test('один и тот же день, разошедшийся по списку, НЕ склеивается', () => {
  // Порядок задаёт вызывающий, и группировка его не переставляет. Если список
  // пришёл неотсортированным, это видно, а не замазано.
  const items = [
    { id: 'a', at: new Date(2026, 8, 17, 10).toISOString() },
    { id: 'c', at: new Date(2026, 8, 16, 20).toISOString() },
    { id: 'b', at: new Date(2026, 8, 17, 9).toISOString() },
  ];
  const g = groupByDay(items, i => i.at, NOW);
  assert.equal(g.length, 3);
});

test('элементы без даты собираются в «РАНЬШЕ»', () => {
  const items = [{ id: 'a', at: null }, { id: 'b', at: null }];
  const g = groupByDay(items, i => i.at, NOW);
  assert.equal(g.length, 1);
  assert.equal(g[0].label, 'РАНЬШЕ');
  assert.equal(g[0].items.length, 2);
});
