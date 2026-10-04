import test from 'node:test';
import assert from 'node:assert/strict';
import { METRO_LINES, getMetroLineById, getMetroLineByStation } from '../constants/metro.ts';

// Старый код: METRO_LINES.find(l => l.stations.includes(s)) ?? null, под guard `s ? ... : null`
const oldByStation = (s?: string | null) =>
  s ? METRO_LINES.find(l => l.stations.includes(s)) ?? null : null;
const oldById = (id?: string) => METRO_LINES.find(l => l.id === id);

const stations: (string | null | undefined)[] = [
  'Лубянка', 'Сокольники', 'Воробьёвы горы', 'Воробьевы горы', 'лубянка', ' Лубянка ',
  'Несуществующая', '', null, undefined,
];

test('поиск линии по станции совпадает со старым выводом', () => {
  for (const s of stations) {
    assert.equal(getMetroLineByStation(s), oldByStation(s), String(s));
  }
});

test('станция: найдена, регистр/ё/пробелы не нормализуются, нет — null', () => {
  assert.equal(getMetroLineByStation('Лубянка')?.id, 'sok');
  assert.equal(getMetroLineByStation('лубянка'), null);
  assert.equal(getMetroLineByStation('Воробьевы горы'), null);
  assert.equal(getMetroLineByStation(' Лубянка '), null);
  assert.equal(getMetroLineByStation('Несуществующая'), null);
  assert.equal(getMetroLineByStation(''), null);
});

test('поиск линии по id совпадает со старым выводом', () => {
  for (const id of ['sok', 'mck', 'pink', 'SOK', 'nope', '', undefined]) {
    assert.equal(getMetroLineById(id), oldById(id), String(id));
  }
  assert.equal(getMetroLineById(null), undefined);
  assert.equal(getMetroLineById('sok')?.name, 'Сокольническая');
});
