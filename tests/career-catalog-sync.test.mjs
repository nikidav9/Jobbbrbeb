import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sites = fs.readFileSync(new URL('../scripts/career-sites.tsv', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../infra/sync-career-catalog.sh', import.meta.url), 'utf8');
const migrate = fs.readFileSync(new URL('../infra/migrate.sh', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/career-discover.yml', import.meta.url), 'utf8');

const rows = sites
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [name, url] = line.split('\t');
    return { name, url };
  });
const baseName = (name) => name.split(/\s+·\s+/)[0];

test('master-list содержит весь текущий каталог: 163 компании / 169 разделов', () => {
  assert.equal(rows.length, 169);
  assert.equal(new Set(rows.map(({ name }) => baseName(name))).size, 163);
  assert.equal(new Set(rows.map(({ url }) => url)).size, 169);
});

test('production синхронизируется именно из master-list', () => {
  assert.match(sync, /scripts\/career-sites\.tsv/);
  assert.match(sync, /'career_owner'/);
  assert.match(sync, /connector_config = excluded\.connector_config/);
  assert.match(sync, /encode\('idna'\)/);
  assert.match(migrate, /sync-career-catalog\.sh/);
});

test('разведка автоматически перепроверяет каталог только при релевантных изменениях', () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /scripts\/career-sites\.tsv/);
  assert.match(workflow, /scripts\/career-discover\.mjs/);
  assert.match(workflow, /workflow_dispatch:/);
});
