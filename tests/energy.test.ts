import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_ENERGY, energyDay, rollover, spend, refund, parseEnergy,
} from '../services/energy.ts';

// Правило «запас не копится» ломается молча: экран покажет число, и никто не
// заметит, что вчерашний остаток переехал в сегодня. Поэтому оно под тестом.

test('новый день даёт полный запас, вчерашний остаток сгорает', () => {
  assert.deepEqual(rollover({ day: '2026-09-16', left: 37 }, '2026-09-17'),
    { day: '2026-09-17', left: DAILY_ENERGY });
  // И наоборот: в тот же день остаток сохраняется.
  assert.deepEqual(rollover({ day: '2026-09-17', left: 12 }, '2026-09-17'),
    { day: '2026-09-17', left: 12 });
});

test('пустое хранилище — полный запас', () => {
  assert.deepEqual(rollover(null, '2026-09-17'), { day: '2026-09-17', left: DAILY_ENERGY });
  assert.deepEqual(rollover(undefined, '2026-09-17'), { day: '2026-09-17', left: DAILY_ENERGY });
});

test('испорченная запись не даёт ни отрицательного запаса, ни лишнего', () => {
  assert.equal(rollover({ day: '2026-09-17', left: -5 }, '2026-09-17').left, 0);
  assert.equal(rollover({ day: '2026-09-17', left: 9999 }, '2026-09-17').left, DAILY_ENERGY);
  assert.equal(rollover({ day: '2026-09-17', left: NaN }, '2026-09-17').left, DAILY_ENERGY);
  assert.equal(rollover({ day: '2026-09-17', left: 7.9 }, '2026-09-17').left, 7);
});

test('списание не уходит ниже нуля', () => {
  assert.deepEqual(spend({ day: 'd', left: 1 }), { day: 'd', left: 0 });
  assert.deepEqual(spend({ day: 'd', left: 0 }), { day: 'd', left: 0 });
});

test('возврат не печатает энергию из воздуха', () => {
  assert.deepEqual(refund({ day: 'd', left: 5 }), { day: 'd', left: 6 });
  // Свайпнул — вернул, по кругу: выше дневного запаса не поднимается.
  assert.deepEqual(refund({ day: 'd', left: DAILY_ENERGY }), { day: 'd', left: DAILY_ENERGY });
});

test('день считается по местному времени, а не по UTC', () => {
  // 31 декабря 23:30 по местному времени — это ещё 31-е, хотя в UTC уже
  // может быть 1 января. Раньше на этом горели: запас обновлялся не в
  // полночь пользователя, а в полночь Гринвича.
  const local = new Date(2026, 11, 31, 23, 30, 0);
  assert.equal(energyDay(local), '2026-12-31');
  const early = new Date(2026, 0, 1, 0, 5, 0);
  assert.equal(energyDay(early), '2026-01-01');
});

test('разбор хранилища: мусор равносилен пустоте', () => {
  assert.equal(parseEnergy(null), null);
  assert.equal(parseEnergy('не json'), null);
  assert.equal(parseEnergy('{"day":5,"left":5}'), null);
  assert.equal(parseEnergy('{"day":"2026-09-17"}'), null);
  assert.deepEqual(parseEnergy('{"day":"2026-09-17","left":3}'), { day: '2026-09-17', left: 3 });
});

test('полный день: сорок свайпов и стена', () => {
  let s = rollover(null, '2026-09-17');
  for (let i = 0; i < DAILY_ENERGY; i++) s = spend(s);
  assert.equal(s.left, 0);
  // Дальше свайпать нечем — и это должно пережить перезапуск приложения.
  assert.equal(rollover(s, '2026-09-17').left, 0);
  // А назавтра снова полный запас.
  assert.equal(rollover(s, '2026-09-18').left, DAILY_ENERGY);
});
