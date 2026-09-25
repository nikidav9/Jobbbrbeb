import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

test('master-list содержит весь текущий каталог: 408 компаний / 415 разделов', () => {
  assert.equal(rows.length, 415);
  assert.equal(new Set(rows.map(({ name }) => baseName(name))).size, 408);
  assert.equal(new Set(rows.map(({ url }) => url)).size, 415);
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

test('скрипт читает DISCOVERED и подмешивает найденные разведкой endpoints', () => {
  assert.match(sync, /DISCOVERED=\$\{DISCOVERED:-/);
  assert.match(sync, /"\$DISCOVERED"/);
  assert.match(sync, /discovered_count/);
});

// Логику слияния repo-endpoints и DISCOVERED вынесли в python внутри
// sync-career-catalog.sh — вытаскиваем ровно этот код и прогоняем на
// временных файлах, а не проверяем текст скрипта по регулярке: так тест
// падает при реальной порче поведения, а не только формулировки.
function extractMergePython() {
  const marker = "merged_out=$(python3 - \"$endpoints\" \"$DISCOVERED\" <<'PY'\n";
  const start = sync.indexOf(marker);
  assert.ok(start !== -1, 'в sync-career-catalog.sh не нашёлся блок слияния DISCOVERED');
  const bodyStart = start + marker.length;
  const end = sync.indexOf('\nPY\n', bodyStart);
  assert.ok(end !== -1, 'у python-блока слияния нет закрывающего PY');
  return sync.slice(bodyStart, end);
}

function runMerge(repoRows, discoveredValue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-discovered-'));
  const discoveredPath = path.join(dir, 'discovered.json');
  if (discoveredValue === undefined) {
    // файл не существует — путь просто не создаём
  } else if (typeof discoveredValue === 'string') {
    fs.writeFileSync(discoveredPath, discoveredValue);
  } else {
    fs.writeFileSync(discoveredPath, JSON.stringify(discoveredValue));
  }
  const script = extractMergePython();
  const result = spawnSync('python3', ['-c', script, JSON.stringify(repoRows), discoveredPath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split('\n');
  return {
    endpoints: JSON.parse(lines[0]),
    discoveredCount: Number(lines[1]),
    stderr: result.stderr,
  };
}

test('DISCOVERED: при совпадении URL побеждает репозиторий', () => {
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const found = [
    { url: 'https://a.example.com/api', mode: 'html_links', company: 'A', discovered_at: 'now' },
  ];
  const { endpoints: merged, discoveredCount } = runMerge(repo, found);
  assert.deepEqual(merged, repo);
  assert.equal(discoveredCount, 0);
});

test('DISCOVERED: служебные поля company/discovered_at не попадают в итог', () => {
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const found = [
    {
      url: 'https://new.example.com/api',
      mode: 'json',
      map: { x: 'y' },
      company: 'New Co',
      discovered_at: '2026-09-01T00:00:00Z',
    },
  ];
  const { endpoints: merged, discoveredCount } = runMerge(repo, found);
  assert.equal(discoveredCount, 1);
  const added = merged.find((e) => e.url === 'https://new.example.com/api');
  assert.deepEqual(added, { url: 'https://new.example.com/api', mode: 'json', map: { x: 'y' } });
  assert.ok(!('company' in added) && !('discovered_at' in added));
});

test('DISCOVERED: отсутствующий или пустой файл не меняет поведение', () => {
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const missing = runMerge(repo, undefined);
  assert.deepEqual(missing.endpoints, repo);
  assert.equal(missing.discoveredCount, 0);

  const empty = runMerge(repo, '');
  assert.deepEqual(empty.endpoints, repo);
  assert.equal(empty.discoveredCount, 0);
});

test('DISCOVERED: битая запись пропускается с сообщением в stderr, а не валит сборку', () => {
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const { endpoints: merged, discoveredCount, stderr } = runMerge(repo, [
    { url: 'https://bad.example.com/api', mode: 'weird' },
    { url: 'not-a-url', mode: 'json' },
  ]);
  assert.deepEqual(merged, repo);
  assert.equal(discoveredCount, 0);
  assert.match(stderr, /пропускаю/);
});

test('DISCOVERED: файл, который не парсится как JSON-массив, считается пустым', () => {
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const { endpoints: merged, discoveredCount, stderr } = runMerge(repo, '{not json');
  assert.deepEqual(merged, repo);
  assert.equal(discoveredCount, 0);
  assert.match(stderr, /не удалось прочитать/);
});

test('DISCOVERED: файл с невалидными UTF-8 байтами не валит синк', () => {
  // UnicodeDecodeError — подкласс ValueError, ловится тем же except, что и
  // битый JSON: запись пропускается, результат как без файла вовсе.
  const repo = [{ url: 'https://a.example.com/api', mode: 'json' }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-discovered-'));
  const discoveredPath = path.join(dir, 'discovered.json');
  fs.writeFileSync(discoveredPath, Buffer.from([0xff, 0xfe, 0x5b]));
  const script = extractMergePython();
  const result = spawnSync('python3', ['-c', script, JSON.stringify(repo), discoveredPath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.deepEqual(JSON.parse(lines[0]), repo);
  assert.equal(Number(lines[1]), 0);
  assert.match(result.stderr, /не удалось прочитать/);
});
