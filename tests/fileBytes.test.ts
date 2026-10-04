import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64 } from '../lib/base64.ts';

test('base64ToBytes совпадает с Buffer для любой длины хвоста', () => {
  for (let n = 0; n < 12; n++) {
    const src = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 200) & 255);
    const b64 = Buffer.from(src).toString('base64');
    assert.deepEqual(Array.from(base64ToBytes(b64)), Array.from(src));
  }
});

test('bytesToBase64 совпадает с Buffer', () => {
  for (let n = 0; n < 12; n++) {
    const src = Uint8Array.from({ length: n }, (_, i) => (i * 91 + 7) & 255);
    assert.equal(bytesToBase64(src), Buffer.from(src).toString('base64'));
  }
});

test('base64ToBytes игнорирует переносы строк', () => {
  assert.deepEqual(Array.from(base64ToBytes('AQID\nBA==')), [1, 2, 3, 4]);
});
