// Перечень «Работодатели Юпитера» (Соглашение п. 8.4) обязан совпадать с
// каталогом разведки: боевая подача идёт только на его хосты, и отставший
// перечень означал бы отклик туда, о ком документ молчит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { employersFromTsv } from '../scripts/gen-jupiter-employers.mjs';

test('перечень работодателей совпадает с каталогом разведки', () => {
  const expected = employersFromTsv(readFileSync('scripts/career-sites.tsv', 'utf8'));
  const src = readFileSync('constants/jupiterEmployers.ts', 'utf8');
  const actual = [...src.matchAll(/^\s*\[("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\],$/gm)]
    .map(m => [JSON.parse(m[1]), JSON.parse(m[2])]);
  assert.deepEqual(actual, expected, 'запустите node scripts/gen-jupiter-employers.mjs');
  assert.ok(actual.length > 400);
});

test('документ о работодателях есть в наборе и ссылается на перечень', () => {
  const legal = readFileSync('constants/legal.ts', 'utf8');
  assert.match(legal, /employers: \{/);
  assert.match(legal, /JUPITER_EMPLOYERS/);
  assert.match(legal, /Работодатели Юпитера/);
});
