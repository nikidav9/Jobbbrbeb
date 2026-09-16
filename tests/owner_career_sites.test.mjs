import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ownerTsv = fs.readFileSync(new URL('../scripts/owner-career-sites.tsv', import.meta.url), 'utf8');
const initialMigration = fs.readFileSync(new URL('../supabase/migrations/087_owner_career_sites.sql', import.meta.url), 'utf8');
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const allMigrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsDir), 'utf8'))
  .join('\n');

const rows = ownerTsv
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [name, url] = line.split('\t');
    return { name, url };
  });

const baseName = (name) => name.split(/\s+·\s+/)[0];
const runtimeUrl = (url) =>
  url === 'https://работаярче.рф' ? 'https://xn--80aacr7bjeo1cwe.xn--p1ai' : url;

test('исходный список владельца сохранён целиком: 62 компании / 68 разделов', () => {
  assert.equal(rows.length, 68);
  assert.equal(new Set(rows.map(({ name }) => baseName(name))).size, 62);
  assert.equal(new Set(rows.map(({ url }) => url)).size, 68);
});

test('в миграциях зарегистрирован каждый актуальный карьерный URL владельца', () => {
  // 087 — исторический снимок первоначального списка. Поздние проверки могут
  // подтвердить более точный URL каталога (например /vakancies/ у Петровича),
  // поэтому актуальный адрес должен встречаться в истории миграций целиком, а
  // не обязательно в первом снимке.
  for (const { name, url } of rows) {
    assert.ok(
      allMigrations.includes(runtimeUrl(url)),
      `Нет карьерного URL для ${name}: ${url}`,
    );
  }
});

test('все источники прямые и безопасно заданы как HTTPS', () => {
  for (const { name, url } of rows) {
    assert.match(url, /^https:\/\//, `${name}: нужен HTTPS`);
    assert.doesNotMatch(url, /(^|\/\/)([^/]*\.)?hh\.ru(?:\/|$)/i);
    assert.doesNotMatch(url, /(^|\/\/)([^/]*\.)?superjob\.ru(?:\/|$)/i);
    assert.doesNotMatch(url, /(^|\/\/)([^/]*\.)?avito\.ru(?:\/|$)/i);
  }
  assert.ok(initialMigration.includes('https://xn--80aacr7bjeo1cwe.xn--p1ai'));
  assert.ok(!initialMigration.includes('https://работаярче.рф'));
});

test('новый список не перезаписывает основной career-коннектор', () => {
  assert.match(initialMigration, /'career_owner'/);
  assert.doesNotMatch(initialMigration, /where\s+id\s*=\s*'career'/i);
  assert.match(initialMigration, /connector_kind[\s\S]*'career'/);
});
