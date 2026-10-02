// Сайт на компьютере открывает документы у себя (public/landing/docs.json), а не
// в приложении. Файл обязан совпадать с constants/legal.ts — иначе сайт показал
// бы старую редакцию.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landingDocs, LANDING_DOC_KEYS } from '../scripts/gen-landing-docs.ts';

test('документы сайта совпадают с constants/legal.ts', () => {
  assert.equal(readFileSync('public/landing/docs.json', 'utf8'), landingDocs(),
    'запустите node --experimental-strip-types scripts/gen-landing-docs.ts');
});

test('на сайте все документы из списка приложения', () => {
  const app = readFileSync('app/legal.tsx', 'utf8');
  const listed = [...app.slice(app.indexOf('ALL_DOC_KEYS'), app.indexOf('];', app.indexOf('ALL_DOC_KEYS')))
    .matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...LANDING_DOC_KEYS].sort(), [...listed].sort());
});

test('ссылки на документы на сайте не уводят в приложение', () => {
  const landing = readFileSync('constants/landing.ts', 'utf8');
  assert.doesNotMatch(landing, /href="\/legal/);
  assert.match(landing, /data-jtl-doc="terms"/);
  assert.match(landing, /\/landing\/docs\.json/);
});
