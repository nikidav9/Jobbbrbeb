import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TAPS, addTap, fitImage, pngSize, tapFromPress, tapsToAnswer,
} from '../services/captchaTaps.ts';

// Настоящий PNG 1x1 (заголовок + IHDR), увеличенный до 304x78 правкой IHDR.
function pngBase64(width: number, height: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

test('размер PNG читается из заголовка', () => {
  assert.deepEqual(pngSize(pngBase64(304, 78)), { width: 304, height: 78 });
  assert.deepEqual(pngSize(pngBase64(400, 580)), { width: 400, height: 580 });
});

test('не PNG и обрезанный заголовок — null', () => {
  assert.equal(pngSize(''), null);
  assert.equal(pngSize('AAAA'), null);
  assert.equal(pngSize(Buffer.from('GIF89a'.repeat(10)).toString('base64')), null);
  assert.equal(pngSize(pngBase64(0, 10)), null);
});

test('нажатие переводится в доли снимка и не выходит за 0..1', () => {
  assert.deepEqual(tapFromPress(152, 39, 304, 78), { x: 0.5, y: 0.5 });
  assert.deepEqual(tapFromPress(-5, 900, 304, 78), { x: 0, y: 1 });
  assert.equal(tapFromPress(10, 10, 0, 78), null);
  assert.equal(tapFromPress(NaN, 10, 304, 78), null);
});

test('ответ — «x,y;x,y» ровно в формате сервера', () => {
  const answer = tapsToAnswer([{ x: 0.5, y: 0.25 }, { x: 1, y: 0 }]);
  assert.equal(answer, '0.5000,0.2500;1.0000,0.0000');
  // тот же шаблон, что в php-proxy/db.php: до 4 знаков, до 12 точек
  const pt = '(?:0(?:\\.\\d{1,4})?|1(?:\\.0{1,4})?)';
  const re = new RegExp(`^${pt},${pt}(?:;${pt},${pt}){0,11}$`);
  assert.match(answer, re);
});

test('больше двенадцати нажатий не принимаем', () => {
  let taps: { x: number; y: number }[] = [];
  for (let i = 0; i < 20; i++) taps = addTap(taps, { x: 0.1, y: 0.1 });
  assert.equal(taps.length, MAX_TAPS);
  assert.equal(tapsToAnswer(taps).split(';').length, MAX_TAPS);
});

test('снимок вписывается по ширине и по высоте', () => {
  assert.deepEqual(fitImage({ width: 304, height: 78 }, 304, 420), { width: 304, height: 78 });
  assert.deepEqual(fitImage({ width: 400, height: 580 }, 300, 420), { width: 290, height: 420 });
  assert.equal(fitImage(null, 300, 420).width, 300);
});
