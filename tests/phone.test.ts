import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneDigits, formatPhoneRu, nationalDigits, formatNationalDigits } from '../lib/phone.ts';

// вход, phoneDigits, formatPhoneRu, nationalDigits — поведение старых копий
const inputs: [string | null | undefined, string, string, string][] = [
  ['+7 999 003-10-23', '79990031023', '+7 999 003-10-23', '9990031023'],
  ['8 999 0031023', '89990031023', '+8 999 003-10-23', '9990031023'],
  ['9990031023', '9990031023', '9990031023', '9990031023'],
  ['', '', '', ''],
  [null, '', '', ''],
  [undefined, '', '', ''],
  ['abc', '', 'abc', ''],
  ['+7 (999) 003', '7999003', '+7 (999) 003', '7999003'],
  ['123456789012', '123456789012', '123456789012', '1234567890'],
];

test('phoneDigits / formatPhoneRu / nationalDigits: таблица поведения старых копий', () => {
  for (const [raw, dig, fmt, nat] of inputs) {
    assert.equal(phoneDigits(raw), dig, `digits ${raw}`);
    if (typeof raw === 'string') assert.equal(formatPhoneRu(raw), fmt, `fmt ${raw}`);
    assert.equal(nationalDigits(raw), nat, `national ${raw}`);
  }
});

test('formatNationalDigits: маска шторки', () => {
  assert.equal(formatNationalDigits(''), '');
  assert.equal(formatNationalDigits('99'), '99');
  assert.equal(formatNationalDigits('9990'), '999 0');
  assert.equal(formatNationalDigits('999003'), '999 003');
  assert.equal(formatNationalDigits('99900310'), '999 003-10');
  assert.equal(formatNationalDigits('9990031023'), '999 003-10-23');
});
