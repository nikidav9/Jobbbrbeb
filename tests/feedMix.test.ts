import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOfPerm, rankOwn, interleaveDeck } from '../services/feedMix.ts';

// ─── sectionOfPerm ─────────────────────────────────────────────────────────

test('раздел своей вакансии берётся по виду работ', () => {
  assert.equal(sectionOfPerm('cook'), 'food');
  assert.equal(sectionOfPerm('stocker'), 'warehouse');
  assert.equal(sectionOfPerm('picker'), 'warehouse');
  assert.equal(sectionOfPerm('shift_supervisor'), 'warehouse');
});

test('незнакомый или пустой вид работ уходит в «other»', () => {
  assert.equal(sectionOfPerm(null), 'other');
  assert.equal(sectionOfPerm(undefined), 'other');
});

// ─── rankOwn ────────────────────────────────────────────────────────────────

test('ранжирование поднимает раздел из предпочтений и станцию метро', () => {
  const items = [
    { id: 'a', workType: undefined, metroStation: 'Сокол' },       // 0 очков
    { id: 'b', workType: 'cook' as const, metroStation: 'Сокол' }, // 2 (раздел) + 1 (метро) = 3
    { id: 'c', workType: 'cook' as const, metroStation: 'ВДНХ' },  // 2
  ];
  const ranked = rankOwn(items, { sections: ['food'], metro: 'Сокол' });
  assert.deepEqual(ranked.map(x => x.id), ['b', 'c', 'a']);
});

test('при равенстве очков порядок исходного списка не трогается', () => {
  const items = [
    { id: 'a', workType: 'cook' as const, metroStation: null },
    { id: 'b', workType: 'stocker' as const, metroStation: null },
    { id: 'c', workType: 'cook' as const, metroStation: null },
  ];
  // Ни один раздел не в предпочтениях — у всех 0 очков, порядок исходный.
  const ranked = rankOwn(items, { sections: [], metro: null });
  assert.deepEqual(ranked.map(x => x.id), ['a', 'b', 'c']);
});

test('станция метро сравнивается без учёта регистра и «ё»/«е»', () => {
  const items = [
    { id: 'a', workType: undefined, metroStation: 'Теплый Стан' },
    { id: 'b', workType: undefined, metroStation: 'Другая' },
  ];
  const ranked = rankOwn(items, { sections: [], metro: 'тёплый стан' });
  assert.deepEqual(ranked.map(x => x.id), ['a', 'b']);
});

// ─── interleaveDeck ─────────────────────────────────────────────────────────

test('чередование: каждая третья карта своя, остальные — карьерные', () => {
  const own = ['o1', 'o2', 'o3'];
  const ext = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
  const deck = interleaveDeck(own, ext, 3);
  assert.deepEqual(deck.map(c => (c.own ? `O:${c.v}` : `E:${c.v}`)), [
    'O:o1', 'E:e1', 'E:e2',
    'O:o2', 'E:e3', 'E:e4',
    'O:o3', 'E:e5', 'E:e6',
  ]);
});

test('своя лента кончилась раньше — хвост карьерных идёт по порядку', () => {
  const own = ['o1'];
  const ext = ['e1', 'e2', 'e3', 'e4'];
  const deck = interleaveDeck(own, ext, 3);
  assert.deepEqual(deck.map(c => (c.own ? `O:${c.v}` : `E:${c.v}`)), [
    'O:o1', 'E:e1', 'E:e2', 'E:e3', 'E:e4',
  ]);
});

test('карьерная лента кончилась раньше — хвост своих идёт по порядку', () => {
  const own = ['o1', 'o2', 'o3', 'o4'];
  const ext = ['e1'];
  const deck = interleaveDeck(own, ext, 3);
  assert.deepEqual(deck.map(c => (c.own ? `O:${c.v}` : `E:${c.v}`)), [
    'O:o1', 'E:e1', 'O:o2', 'O:o3', 'O:o4',
  ]);
});

test('пустые списки дают пустую колоду', () => {
  assert.deepEqual(interleaveDeck([], []), []);
});

test('пустая своя лента — вся колода карьерная, в исходном порядке', () => {
  const deck = interleaveDeck([], ['e1', 'e2']);
  assert.deepEqual(deck.map(c => (c.own ? `O:${c.v}` : `E:${c.v}`)), ['E:e1', 'E:e2']);
});

test('пустая карьерная лента — вся колода своя, в исходном порядке', () => {
  const deck = interleaveDeck(['o1', 'o2'], []);
  assert.deepEqual(deck.map(c => (c.own ? `O:${c.v}` : `E:${c.v}`)), ['O:o1', 'O:o2']);
});
