#!/usr/bin/env node
// Полный read-only smoke production карьерного каталога.
//
// career.php отдаёт ровно одну единицу/страницу за запрос и next_url. Проверка
// обязана дойти до has_more=false: первый HTTP 200 ничего не говорит о 34-м
// работодателе. Скрипт не ходит по внешним vacancy URL и ничего не меняет.

const START = process.env.CAREER_SMOKE_URL || 'https://jobtoo.ru/api/career.php?source=career_owner';
const MAX_HOPS = Number(process.env.CAREER_SMOKE_MAX_HOPS || 250);
const MIN_ITEMS = Number(process.env.CAREER_SMOKE_MIN_ITEMS || 500);
const TIMEOUT_MS = Number(process.env.CAREER_SMOKE_TIMEOUT_MS || 45_000);

function die(message, details = null) {
  console.error(`CAREER SMOKE FAIL: ${message}`);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

let start;
try {
  start = new URL(START);
} catch {
  die(`invalid CAREER_SMOKE_URL: ${START}`);
}
if (start.protocol !== 'https:') die('smoke URL must be HTTPS');

const allowedOrigin = start.origin;
const visited = new Set();
const failed = [];
const skipped = [];
const malformedItems = [];
const companies = new Map();
let partialResponses = 0;
let totalItems = 0;
let current = start.href;
let terminal = false;
let hops = 0;

for (; hops < MAX_HOPS; hops += 1) {
  if (visited.has(current)) die(`next_url loop at ${current}`);
  visited.add(current);

  const url = new URL(current);
  if (url.origin !== allowedOrigin) die(`next_url left JobToo origin: ${current}`);
  if (url.protocol !== 'https:') die(`next_url is not HTTPS: ${current}`);

  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'JobToo-career-smoke/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    die(`request failed at hop ${hops}: ${current}`, { error: String(error) });
  }
  if (!response.ok) die(`HTTP ${response.status} at hop ${hops}: ${current}`);

  let body;
  try {
    body = await response.json();
  } catch (error) {
    die(`invalid JSON at hop ${hops}: ${current}`, { error: String(error) });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    die(`JSON root is not an object at hop ${hops}`);
  }

  const items = asArray(body.items);
  totalItems += items.length;
  if (body.partial === true) partialResponses += 1;

  for (const item of items) {
    const company = String(item?.company || '').trim();
    const title = String(item?.title || '').trim();
    const vacancyUrl = String(item?.url || '').trim();
    if (company) companies.set(company, (companies.get(company) || 0) + 1);

    let urlOk = false;
    try {
      const parsed = new URL(vacancyUrl);
      urlOk = parsed.protocol === 'https:';
    } catch {
      urlOk = false;
    }
    if (!title || !urlOk) {
      malformedItems.push({ company, title, url: vacancyUrl, hop: hops });
    }
  }

  for (const row of asArray(body.failed)) {
    failed.push(typeof row === 'string' ? { value: row, hop: hops } : { ...row, hop: hops });
  }
  for (const row of asArray(body.skipped)) {
    skipped.push(typeof row === 'string' ? { value: row, hop: hops } : { ...row, hop: hops });
  }

  if (body.has_more === false) {
    terminal = true;
    break;
  }
  if (body.has_more !== true) die(`has_more is neither true nor false at hop ${hops}`);
  if (typeof body.next_url !== 'string' || !body.next_url.trim()) {
    die(`has_more=true without next_url at hop ${hops}`);
  }
  current = new URL(body.next_url, url).href;
}

const summary = {
  start: START,
  responses: visited.size,
  terminal,
  total_items: totalItems,
  companies: companies.size,
  partial_responses: partialResponses,
  failed_count: failed.length,
  skipped_count: skipped.length,
  malformed_items: malformedItems.length,
  top_companies: [...companies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
};
console.log(JSON.stringify(summary, null, 2));

if (!terminal) die(`did not reach has_more=false within ${MAX_HOPS} responses`, summary);
if (failed.length) die('career_owner returned failed endpoints', failed);
if (skipped.length) die('career_owner returned skipped endpoints', skipped);
if (partialResponses) die('career_owner returned partial responses without explicit failed/skipped');
if (malformedItems.length) die('vacancies without title or HTTPS source URL', malformedItems.slice(0, 20));
if (totalItems < MIN_ITEMS) die(`only ${totalItems} vacancies; expected at least ${MIN_ITEMS}`, summary);
if (companies.size < 5) die(`only ${companies.size} companies; expected at least 5`, summary);

console.log('CAREER SMOKE OK');
