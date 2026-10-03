// Ссылки jobtoo.ru открывают приложение (решение владельца 03.10.2026):
// Android App Links в app.json. Это часть манифеста — после выхода приложения
// поменять можно только новой сборкой.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const filter = app.android.intentFilters?.[0];

test('фильтр ссылок: https, jobtoo.ru, автопроверка, можно открыть из браузера', () => {
  assert.ok(filter, 'в app.json нет android.intentFilters');
  assert.equal(filter.action, 'VIEW');
  assert.equal(filter.autoVerify, true);
  assert.deepEqual([...filter.category].sort(), ['BROWSABLE', 'DEFAULT']);
  for (const d of filter.data) {
    assert.equal(d.scheme, 'https');
    assert.equal(d.host, 'jobtoo.ru');
  }
});

test('каждый перехватываемый путь — настоящий экран приложения', () => {
  const prefixes = filter.data.filter(d => d.pathPrefix).map(d => d.pathPrefix);
  assert.ok(prefixes.length > 0);
  for (const p of prefixes) {
    const name = p.replace(/^\//, '');
    const exists = ['app', 'app/(tabs)'].some(d =>
      fs.existsSync(path.join(root, d, `${name}.tsx`)) || fs.existsSync(path.join(root, d, name)));
    assert.ok(exists, `нет экрана для ${p}`);
  }
});

test('служебные адреса сайта приложение не перехватывает', () => {
  const all = JSON.stringify(filter.data);
  for (const bad of ['/api', '/.well-known', '/sitemap', '/robots', '/assets', '/_expo', '/admin']) {
    assert.ok(!all.includes(`"${bad}`), `перехватывается ${bad}`);
  }
  // Корень — только точное совпадение, а не префикс (иначе перехватится всё).
  assert.ok(filter.data.some(d => d.path === '/'));
  assert.ok(!filter.data.some(d => d.pathPrefix === '/'));
});

test('возраст 18+ записан в Соглашении (п. 3.1.1)', () => {
  const legal = fs.readFileSync(path.join(root, 'constants/legal.ts'), 'utf8');
  assert.match(legal, /3\.1\.1\. Сервис предназначен для лиц, достигших 18 лет/);
  const i = legal.indexOf('  terms: {');
  assert.match(legal.slice(i, i + 400), /consentVersion: '2026-10-03-2'/);
});
