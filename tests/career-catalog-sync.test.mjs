import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sites = fs.readFileSync(new URL('../scripts/career-sites.tsv', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../infra/sync-career-catalog.sh', import.meta.url), 'utf8');
const migrate = fs.readFileSync(new URL('../infra/migrate.sh', import.meta.url), 'utf8');
const endpoints = JSON.parse(
  fs.readFileSync(new URL('../scripts/career-endpoints.json', import.meta.url), 'utf8'),
);
const quarantine = JSON.parse(
  fs.readFileSync(new URL('../scripts/career-runtime-quarantine.json', import.meta.url), 'utf8'),
);

const rows = sites
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [name, url] = line.split('\t');
    return { name, url };
  });
const baseName = (name) => name.split(/\s+·\s+/)[0];

test('master-list содержит весь текущий каталог: 163 компании / 170 разделов', () => {
  assert.equal(rows.length, 170);
  assert.equal(new Set(rows.map(({ name }) => baseName(name))).size, 163);
  assert.equal(new Set(rows.map(({ url }) => url)).size, 170);
});

test('production синхронизируется именно из master-list', () => {
  assert.match(sync, /scripts\/career-sites\.tsv/);
  assert.match(sync, /'career_owner'/);
  assert.match(sync, /connector_config = excluded\.connector_config/);
  assert.match(sync, /encode\('idna'\)/);
  assert.match(migrate, /sync-career-catalog\.sh/);
});

// Разведка (scripts/career-discover*.mjs и её workflow) пока не возвращена:
// она приедет отдельным срезом, каталог до тех пор заморожен на найденном.
// Поэтому проверяем не её, а сам файл endpoints — теперь он единственный
// экземпляр списка, и молчаливая порча этого файла дороже всего остального.
test('файл endpoints пригоден к употреблению', () => {
  assert.ok(Array.isArray(endpoints) && endpoints.length > 0);
  const urls = new Set();
  for (const item of endpoints) {
    assert.ok(item && typeof item.url === 'string', 'у каждой записи есть url');
    assert.ok(item.url.startsWith('https://'), `только HTTPS: ${item.url}`);
    assert.ok(!urls.has(item.url), `повтор URL: ${item.url}`);
    urls.add(item.url);
    const mode = item.mode ?? 'json';
    assert.ok(['json', 'html_links', 'embedded'].includes(mode), `режим ${mode}`);
  }
});

test('карантин говорит о тех адресах, которые в списке есть', () => {
  const urls = new Set(endpoints.map(({ url }) => url));
  for (const item of quarantine) {
    assert.ok(item.url && item.company && item.reason && item.observed_at,
      'причина и дата обязательны: иначе «временно выкинем» станет вечной потерей');
    assert.ok(urls.has(item.url), `карантин на неизвестный адрес: ${item.url}`);
  }
  const healthy = endpoints.filter(({ url }) => !quarantine.some((q) => q.url === url));
  assert.equal(healthy.length, endpoints.length - quarantine.length);
});
