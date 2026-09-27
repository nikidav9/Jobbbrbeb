// Раздел «Юпитер» в панели (решение владельца 26.09): «сначала замер, потом
// крупные». Замер должен говорить правду: отправленное человеком — не
// автоотклик, припаркованный сайт — не ошибка, и людей в отчёте нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  JUPITER_COLUMNS, bucketOf, siteOf, buildReport, lastDays, type JupiterRow,
} from '../dashboard/lib/jupiterStats.ts';

const row = (over: Partial<JupiterRow>): JupiterRow => ({
  state: 'queued', reason_code: null,
  canonical_url: 'https://www.kontur.ru/career/vacancies/1', vacancy_url: null,
  company: 'Контур', created_at: '2026-09-25T10:00:00Z',
  submitted_at: null, verified_at: null, ...over,
});

test('панель не просит у базы колонок людей', () => {
  const cols = JUPITER_COLUMNS.split(',');
  for (const bad of ['user_id', 'resume_token', 'receipt_key', 'external_application_id', 'checkpoint', 'last_error']) {
    assert.ok(!cols.includes(bad), bad);
  }
  const page = fs.readFileSync(path.resolve(import.meta.dirname, '../dashboard/app/jupiter/page.tsx'), 'utf8');
  assert.match(page, /\.select\(JUPITER_COLUMNS\)/);
});

test('отправленное человеком не считается автооткликом', () => {
  assert.equal(bucketOf({ state: 'submitted', reason_code: null }), 'auto');
  assert.equal(bucketOf({ state: 'submitted', reason_code: 'MANUAL_WEBVIEW' }), 'manual');
});

test('непроверенный сайт — парковка, а не «ждут человека»', () => {
  assert.equal(bucketOf({ state: 'action_required', reason_code: 'SITE_NOT_VERIFIED' }), 'parked');
  assert.equal(bucketOf({ state: 'action_required', reason_code: 'CAPTCHA_REQUIRED' }), 'human');
  assert.equal(bucketOf({ state: 'retryable_failed', reason_code: null }), 'working');
  assert.equal(bucketOf({ state: 'submission_unknown', reason_code: null }), 'failed');
});

test('сайт — хост без www, мусор не роняет отчёт', () => {
  assert.equal(siteOf({ canonical_url: 'https://WWW.Kontur.ru/x', vacancy_url: null }), 'kontur.ru');
  assert.equal(siteOf({ canonical_url: null, vacancy_url: 'https://job.mts.ru/v/1' }), 'job.mts.ru');
  assert.equal(siteOf({ canonical_url: 'не адрес', vacancy_url: null }), '—');
});

test('отчёт: итоги, сайты, причина остановки, период', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const rows = [
    row({ state: 'submitted', verified_at: '2026-09-25T10:05:00Z' }),
    row({ state: 'submitted' }),
    row({ state: 'submitted', reason_code: 'MANUAL_WEBVIEW' }),
    row({ state: 'action_required', reason_code: 'CAPTCHA_REQUIRED' }),
    row({ canonical_url: 'https://job.mts.ru/v/1', company: 'МТС', state: 'action_required', reason_code: 'SITE_NOT_VERIFIED' }),
    row({ canonical_url: 'https://job.mts.ru/v/2', company: 'МТС', state: 'action_required', reason_code: 'SITE_NOT_VERIFIED' }),
    // Старше недели: в 7 днях его нет, в «всё время» есть.
    row({ state: 'failed', reason_code: 'SUBMIT_FAILED', created_at: '2026-09-01T10:00:00Z' }),
  ];
  const week = buildReport(rows, 7, now);
  assert.equal(week.totals.total, 6);
  assert.equal(week.totals.auto, 2);
  assert.equal(week.totals.verified, 1);
  assert.equal(week.totals.manual, 1);
  assert.equal(week.totals.human, 1);
  assert.equal(week.totals.parked, 2);
  assert.equal(week.totals.failed, 0);

  const kontur = week.sites.find(s => s.site === 'kontur.ru')!;
  assert.deepEqual([kontur.total, kontur.auto, kontur.verified, kontur.human], [4, 2, 1, 1]);
  assert.equal(kontur.topReason, 'CAPTCHA_REQUIRED');
  const mts = week.sites.find(s => s.site === 'job.mts.ru')!;
  assert.deepEqual([mts.company, mts.parked, mts.topReason, mts.topReasonCount], ['МТС', 2, 'SITE_NOT_VERIFIED', 2]);

  assert.equal(week.days.length, 7);
  assert.equal(week.days.at(-1)!.day, '2026-09-26');
  const d25 = week.days.find(d => d.day === '2026-09-25')!;
  assert.deepEqual([d25.auto, d25.manual, d25.human, d25.parked, d25.other], [2, 1, 1, 2, 0]);

  const all = buildReport(rows, 0, now);
  assert.equal(all.totals.total, 7);
  assert.equal(all.totals.failed, 1);
  assert.equal(all.days.length, 30);
});

test('день считается по Москве: 22:30 UTC — уже следующий день', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const r = buildReport([row({ created_at: '2026-09-25T22:30:00Z' })], 7, now);
  assert.equal(r.days.find(d => d.day === '2026-09-26')!.other, 1);
  assert.deepEqual(lastDays(3, new Date('2026-09-25T22:30:00Z')), ['2026-09-24', '2026-09-25', '2026-09-26']);
});
