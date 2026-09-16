#!/usr/bin/env node
/**
 * Read-only сверка master-list JobToo с публичным каталогом Cofinder.
 *
 * Зачем: Cofinder уже хранит у разобранных вакансий конкретный URL
 * работодателя. Нам эти данные нужны только как подсказка для разведки:
 * сопоставить компанию, взять 1–2 прямые ссылки и понять реальный шаблон URL.
 * В production-фид Cofinder не подключается и тексты вакансий отсюда не
 * импортируются.
 *
 * Публичные точки, проверенные браузерным аудитом:
 *   /api/v1/companies/?limit=500
 *   /api/v1/vacancies/?company_id=<id>&limit=2
 *
 * Никакого логина, CAPTCHA, cookies или обхода ограничений. Запросы идут
 * последовательно небольшим пулом и с паузой между компаниями.
 */
import fs from 'node:fs';
import process from 'node:process';

const ORIGIN = 'https://cofinder.ru';
const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';
const SOURCE = new URL('./career-sites.tsv', import.meta.url).pathname;
const OUT = process.env.COFINDER_HINTS_OUT || 'cofinder-link-hints.json';
const SAMPLE_LIMIT = Math.min(3, Math.max(1, Number(process.env.COFINDER_HINTS_SAMPLES || 2)));
const CONCURRENCY = Math.min(4, Math.max(1, Number(process.env.COFINDER_HINTS_CONCURRENCY || 2)));
const PAUSE_MS = Math.max(100, Number(process.env.COFINDER_HINTS_PAUSE_MS || 500));
const HARD_LIMIT = Math.max(0, Number(process.env.COFINDER_HINTS_LIMIT || 0));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function rowsFrom(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const key of ['items', 'results', 'data', 'companies', 'vacancies']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

function canonicalName(value) {
  let s = String(value || '').split(' · ', 1)[0].trim().toLowerCase().replaceAll('ё', 'е');
  s = s
    .replace(/^ооо\s+/u, '')
    .replace(/^пао\s+/u, '')
    .replace(/^ао\s+/u, '')
    .replace(/^гк\s+/u, '')
    .replace(/[^a-zа-я0-9]+/giu, '');
  const aliases = new Map([
    ['wildberriesрвб', 'wildberries'],
    ['рвб', 'wildberries'],
    ['авиасейлс', 'aviasales'],
    ['яндекславка', 'лавка'],
    ['mts', 'мтс'],
  ]);
  return aliases.get(s) || s;
}

function hostOf(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function baseCompany(name) {
  return String(name || '').split(' · ', 1)[0].trim();
}

function parseTargets(text) {
  const byCompany = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const name = line.slice(0, tab).trim();
    const url = line.slice(tab + 1).trim();
    if (!name || !/^https:\/\//i.test(url)) continue;
    const company = baseCompany(name);
    const key = canonicalName(company);
    if (!byCompany.has(key)) byCompany.set(key, { company, pages: [] });
    const row = byCompany.get(key);
    if (!row.pages.includes(url)) row.pages.push(url);
  }
  return [...byCompany.values()];
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* caller records non-JSON */ }
  return {
    url,
    status: response.status,
    ok: response.ok,
    body,
    text_prefix: body === null ? text.slice(0, 300) : '',
  };
}

function chooseCompany(target, companies) {
  const key = canonicalName(target.company);
  const byName = companies.filter(c => canonicalName(c?.name) === key);
  if (byName.length === 1) return { row: byName[0], matched_by: 'name' };

  const targetHosts = new Set(target.pages.map(hostOf).filter(Boolean));
  const byHost = companies.filter(c => {
    const h = hostOf(c?.career_url);
    return h && targetHosts.has(h);
  });
  if (byHost.length === 1) return { row: byHost[0], matched_by: 'career_host' };

  if (byName.length > 1) return { row: byName[0], matched_by: 'name_ambiguous' };
  return { row: null, matched_by: '' };
}

function sampleVacancy(row) {
  const url = typeof row?.url === 'string' && /^https?:\/\//i.test(row.url) ? row.url : '';
  return {
    id: row?.id ?? null,
    title: String(row?.title || row?.name || '').trim(),
    company_id: row?.company_id ?? null,
    company_name: String(row?.company_name || row?.company || '').trim(),
    url,
    direct_host: hostOf(url),
  };
}

const targets = parseTargets(fs.readFileSync(SOURCE, 'utf8'));
const catalogReply = await getJson(`${ORIGIN}/api/v1/companies/?limit=500`);
if (!catalogReply.ok || !catalogReply.body) {
  throw new Error(`Cofinder companies API: HTTP ${catalogReply.status}; ${catalogReply.text_prefix}`);
}
const catalog = rowsFrom(catalogReply.body);

let work = targets.map(target => ({ target, match: chooseCompany(target, catalog) }));
if (HARD_LIMIT) work = work.slice(0, HARD_LIMIT);

const output = new Array(work.length);
let cursor = 0;

async function inspect(one, index) {
  const { target, match } = one;
  const c = match.row;
  const entry = {
    company: target.company,
    career_pages: target.pages,
    match: match.matched_by || 'none',
    cofinder: c ? {
      id: c.id ?? null,
      name: String(c.name || ''),
      career_url: String(c.career_url || ''),
      parse_status: String(c.parse_status || ''),
      parse_status_message: String(c.parse_status_message || '').slice(0, 500),
      vacancy_count: Number(c.vacancy_count || 0),
    } : null,
    sample_status: null,
    sample_urls: [],
  };

  if (!c?.id) {
    output[index] = entry;
    return;
  }
  if (String(c.parse_status || '').toLowerCase() !== 'ok' || Number(c.vacancy_count || 0) < 1) {
    entry.sample_status = 'skipped_parser_not_ok';
    output[index] = entry;
    return;
  }

  try {
    const q = new URL(`${ORIGIN}/api/v1/vacancies/`);
    q.searchParams.set('company_id', String(c.id));
    q.searchParams.set('limit', String(SAMPLE_LIMIT));
    const reply = await getJson(q.toString());
    entry.sample_status = `http_${reply.status}`;
    if (reply.ok && reply.body) {
      const rows = rowsFrom(reply.body);
      const samples = rows.slice(0, SAMPLE_LIMIT).map(sampleVacancy).filter(v => v.url);
      const wrongCompany = samples.find(v => v.company_id !== null && String(v.company_id) !== String(c.id));
      if (wrongCompany) {
        entry.sample_status = 'company_filter_mismatch';
      } else {
        entry.sample_status = 'ok';
        entry.sample_urls = samples;
      }
    } else if (reply.text_prefix) {
      entry.sample_error = reply.text_prefix;
    }
  } catch (error) {
    entry.sample_status = 'request_error';
    entry.sample_error = String(error?.message || error).slice(0, 500);
  }
  output[index] = entry;
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
  while (cursor < work.length) {
    const index = cursor++;
    await inspect(work[index], index);
    await sleep(PAUSE_MS);
  }
}));

const report = {
  generated_at: new Date().toISOString(),
  source: `${ORIGIN}/api/v1/companies/ + /api/v1/vacancies/?company_id=…`,
  note: 'read-only discovery hints; Cofinder не является production-источником JobToo',
  stats: {
    jobtoo_companies: work.length,
    matched: output.filter(r => r?.cofinder).length,
    unmatched: output.filter(r => !r?.cofinder).length,
    cofinder_parser_ok: output.filter(r => r?.cofinder?.parse_status === 'ok').length,
    sampled_ok: output.filter(r => r?.sample_status === 'ok').length,
    direct_urls: output.reduce((n, r) => n + (r?.sample_urls?.length || 0), 0),
  },
  companies: output,
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(`Cofinder link hints -> ${OUT}`);
console.log(JSON.stringify(report.stats));
