import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRubPerPeriod } from '../lib/money.ts';

// Старый код, как он был инлайн в экранах: фиксируем вывод, чтобы вынос не сдвинул ни символа.
const oldMonth = (n: number) => `${n.toLocaleString('ru-RU')} ₽/мес`;
const oldPeriod = (n: number, p?: string | null) =>
  `${n.toLocaleString('ru-RU')} ₽/${p === 'hour' ? 'ч' : 'мес'}`;

const values = [0, 80000, 1250000];

test('месяц: company, feed (3 места), admin, perm-vacancy-detail (2 места)', () => {
  for (const n of values) assert.equal(formatRubPerPeriod(n), oldMonth(n));
  assert.match(formatRubPerPeriod(80000), /^80\s000 ₽\/мес$/);
  assert.equal(formatRubPerPeriod(0), '0 ₽/мес');
});

test('период: feed внешних вакансий и ext-vacancy', () => {
  for (const n of values) {
    for (const p of [undefined, null, 'month', 'hour', '']) {
      assert.equal(formatRubPerPeriod(n, p), oldPeriod(n, p));
    }
  }
  assert.match(formatRubPerPeriod(1250000, 'hour'), /^1\s250\s000 ₽\/ч$/);
});

test('склейка с суффиксом «· на руки» не меняется', () => {
  assert.equal(`${formatRubPerPeriod(80000)} · на руки`, `${oldMonth(80000)} · на руки`);
});
