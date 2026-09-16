#!/usr/bin/env node
/**
 * Небольшой read-only аудит Cofinder: как конкурент хранит и выдаёт ссылки
 * вакансий. Нужен не для массового парсинга, а чтобы один раз увидеть реальную
 * схему данных и сравнить её с JobToo.
 *
 * Что делаем:
 *  1. Читаем публичные /api/v1/companies и /api/v1/vacancies.
 *  2. Открываем каталог Chromium-ом и перехватываем только JSON-ответы Cofinder.
 *  3. Берём максимум три публичные карточки вакансий и смотрим их ссылки.
 *
 * Ничего не отправляем, не логинимся, CAPTCHA/защиты не обходим.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import process from 'node:process';

const ORIGIN = 'https://cofinder.ru';
const OUT = process.env.COFINDER_AUDIT_OUT || 'cofinder-audit.json';
const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';
const MAX_DETAIL_PAGES = 3;
const MAX_CAPTURED_RESPONSES = 80;

function shape(value) {
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const listKey = ['items', 'results', 'data', 'vacancies'].find(k => Array.isArray(value[k]));
    return {
      type: 'object',
      keys: keys.slice(0, 40),
      ...(listKey ? { list_key: listKey, count: value[listKey].length } : {}),
      ...(['count', 'total', 'next', 'previous'].reduce((acc, k) => {
        if (value[k] !== undefined) acc[k] = value[k];
        return acc;
      }, {})),
    };
  }
  return { type: typeof value };
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items', 'results', 'data', 'vacancies']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function urlFields(value, path = '$', out = [], depth = 0) {
  if (depth > 7 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 5); i += 1) {
      urlFields(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (typeof item === 'string' && /^https?:\/\//i.test(item)
      && /(url|link|href|apply|source|career|company|external|redirect|vacanc)/i.test(key)) {
      out.push({ path: childPath, key, value: item });
    } else if (typeof item === 'object' && item !== null) {
      urlFields(item, childPath, out, depth + 1);
    }
    if (out.length >= 100) break;
  }
  return out;
}

function compactSample(row) {
  if (!row || typeof row !== 'object') return row;
  const keep = {};
  const preferred = [
    'id', 'slug', 'title', 'name', 'company', 'company_name', 'company_id',
    'url', 'source_url', 'apply_url', 'career_url', 'external_url', 'link', 'href',
    'city', 'location', 'published_at', 'created_at', 'updated_at',
  ];
  for (const key of preferred) if (row[key] !== undefined) keep[key] = row[key];
  keep._fields = Object.keys(row).slice(0, 50);
  keep._url_fields = urlFields(row).slice(0, 30);
  return keep;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* отчёт ниже покажет не-JSON */ }
  return {
    url,
    status: res.status,
    ok: res.ok,
    content_type: res.headers.get('content-type') || '',
    body,
    text_prefix: body === null ? text.slice(0, 500) : undefined,
  };
}

const report = {
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  note: 'read-only; без логина, отправки форм и обхода защит',
  api: {},
  browser: {},
};

for (const [name, url] of Object.entries({
  companies: `${ORIGIN}/api/v1/companies/?limit=500`,
  vacancies: `${ORIGIN}/api/v1/vacancies/?limit=20`,
})) {
  try {
    const r = await getJson(url);
    const rows = listFrom(r.body);
    report.api[name] = {
      url,
      status: r.status,
      content_type: r.content_type,
      shape: shape(r.body),
      first_rows: rows.slice(0, 10).map(compactSample),
      top_level_url_fields: urlFields(r.body).slice(0, 50),
      ...(r.text_prefix ? { text_prefix: r.text_prefix } : {}),
    };
  } catch (error) {
    report.api[name] = { url, error: String(error?.message || error) };
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: UA });
const page = await context.newPage();

const captured = [];
page.on('response', async response => {
  try {
    if (captured.length >= MAX_CAPTURED_RESPONSES) return;
    const u = new URL(response.url());
    if (u.hostname !== 'cofinder.ru' && !u.hostname.endsWith('.cofinder.ru')) return;
    const type = response.headers()['content-type'] || '';
    if (!type.includes('json')) return;
    const body = await response.json();
    captured.push({
      url: response.url(),
      status: response.status(),
      shape: shape(body),
      url_fields: urlFields(body).slice(0, 40),
      first_rows: listFrom(body).slice(0, 3).map(compactSample),
    });
  } catch { /* ответ уже закрыт или не JSON */ }
});

try {
  await page.goto(`${ORIGIN}/vacancies?catalog=all`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  const vacancyLinks = await page.locator('a[href*="/vacancy/"]').evaluateAll(nodes =>
    [...new Set(nodes.map(node => node.href).filter(Boolean))].slice(0, 20));

  report.browser.catalog = {
    url: page.url(),
    title: await page.title(),
    vacancy_links: vacancyLinks,
  };

  const details = [];
  for (const detailUrl of vacancyLinks.slice(0, MAX_DETAIL_PAGES)) {
    const before = captured.length;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        href: node.href,
      })).filter(row => row.href));
      const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(node => ({
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        aria: node.getAttribute('aria-label') || '',
      })).filter(row => row.text || row.aria));
      const external = links.filter(row => {
        try { return new URL(row.href).hostname !== 'cofinder.ru'; } catch { return false; }
      });
      const applyLike = links.filter(row => /(отклик|apply|карьер|работодател|в компанию|перейти)/i.test(row.text));
      details.push({
        url: detailUrl,
        loaded_url: page.url(),
        title: await page.title(),
        external_links: external.slice(0, 30),
        apply_like_links: applyLike.slice(0, 20),
        buttons: buttons.filter(row => /(отклик|apply|карьер|работодател|перейти)/i.test(`${row.text} ${row.aria}`)).slice(0, 20),
        json_responses: captured.slice(before),
      });
    } catch (error) {
      details.push({ url: detailUrl, error: String(error?.message || error) });
    }
  }
  report.browser.details = details;
  report.browser.captured_json = captured;
} catch (error) {
  report.browser.error = String(error?.message || error);
} finally {
  await context.close();
  await browser.close();
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

console.log(`Cofinder audit -> ${OUT}`);
console.log(`companies API: ${report.api.companies?.status ?? report.api.companies?.error}`);
console.log(`vacancies API: ${report.api.vacancies?.status ?? report.api.vacancies?.error}`);
console.log(`catalog vacancy links: ${report.browser.catalog?.vacancy_links?.length ?? 0}`);
for (const detail of report.browser.details || []) {
  console.log(`detail ${detail.url}: external=${detail.external_links?.length ?? 0}, json=${detail.json_responses?.length ?? 0}`);
}
