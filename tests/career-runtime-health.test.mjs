import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const quarantine = JSON.parse(fs.readFileSync(new URL('../scripts/career-runtime-quarantine.json', import.meta.url), 'utf8'));
const sync = fs.readFileSync(new URL('../infra/sync-career-catalog.sh', import.meta.url), 'utf8');
const smoke = fs.readFileSync(new URL('../scripts/career-runtime-smoke.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/career-runtime-smoke.yml', import.meta.url), 'utf8');

const auditedBad = new Set([
  'https://rabota5ka.ru/api/vacancy/hire-request',
  'https://rabota5ka.ru/gw/api/vacancy/hire-request?portals%5B0%5D=cross',
  'https://rabota.cdek.ru/vacancies',
  'https://www.maria-ra.ru/karera-v-seti/vakansii',
  'https://job.rt.ru/backend/api/vacancies',
  'https://careers.yadro.com/api/v1/vacancies/',
  'https://career.rwb.ru/hr-crm-api/api/v2/pub/vacancies',
  'https://job.mts.ru/api/v2/vacancies',
  'https://job.lamoda.ru/api/hr/vacancies/compact',
  'https://vacancies-app.aviasales.ru/api/vacancies?language=ru',
  'https://job.megafon.ru/api/v1/vacancies',
  'https://bsl.dev/vacancies.html',
  'https://cloud.ru/career/vacancies',
  'https://www.ispring.ru/company/jobs/vacancies',
  'https://1c.ru/rus/firm1c/vacan/search',
  'https://team.vk.company/vacancy',
  'https://career.mvideoeldorado.ru/vacancies',
]);

test('production quarantine фиксирует весь подтверждённый обход', () => {
  assert.ok(Array.isArray(quarantine) && quarantine.length > 0);
  const urls = new Set();
  for (const [i, row] of quarantine.entries()) {
    assert.equal(typeof row, 'object', `row ${i}`);
    const url = new URL(row.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(String(row.company || '').trim(), `company ${i}`);
    assert.ok(String(row.reason || '').trim(), `reason ${i}`);
    assert.match(String(row.observed_at || ''), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!urls.has(row.url), `duplicate ${row.url}`);
    urls.add(row.url);
  }
  for (const url of auditedBad) assert.ok(urls.has(url), `missing audited endpoint ${url}`);
});

test('sync фильтрует runtime, но сохраняет полный master-list для discovery', () => {
  assert.match(sync, /career-runtime-quarantine\.json/);
  assert.match(sync, /q\.value->>'url' = expanded\.endpoint->>'url'/);
  assert.match(sync, /'runtime_quarantine', :'quarantine'::jsonb/);
  assert.match(sync, /'catalog_pages', :'catalog_pages'::jsonb/);
  assert.match(sync, /после production-quarantine не осталось карьерных endpoints/);
  assert.match(sync, /set active = false/);
  assert.match(sync, /v\.source_id = 'career_owner'/);
});

test('production smoke проходит всю next_url цепочку и падает на деградации', () => {
  assert.match(smoke, /body\.has_more === false/);
  assert.match(smoke, /body\.next_url/);
  assert.match(smoke, /visited\.has\(current\)/);
  assert.match(smoke, /failed\.length/);
  assert.match(smoke, /skipped\.length/);
  assert.match(smoke, /malformedItems\.length/);
  assert.match(smoke, /totalItems < MIN_ITEMS/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/career-runtime-smoke\.mjs/);
});
