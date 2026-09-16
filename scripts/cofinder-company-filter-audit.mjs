#!/usr/bin/env node
/** Read-only: выяснить, как публичный API Cofinder фильтрует вакансии по компании. */
import fs from 'node:fs';

const ORIGIN = 'https://cofinder.ru';
const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';
const OUT = process.env.COFINDER_FILTER_OUT || 'cofinder-company-filter-audit.json';

async function json(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await response.json(); } catch { /* status is enough */ }
  return { url, status: response.status, body };
}

function items(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.items) ? body.items : [];
}

const companiesResponse = await json(`${ORIGIN}/api/v1/companies/?limit=500`);
const companies = items(companiesResponse.body);
const target = companies.find(c => c.name === 'МТС') || companies.find(c => Number(c.vacancy_count) > 0);
if (!target) throw new Error('Не найдена компания для проверки');

const candidates = [
  ['company_id', String(target.id)],
  ['company_ids', String(target.id)],
  ['company', String(target.id)],
  ['companies', String(target.id)],
];

const probes = [];
for (const [param, value] of candidates) {
  const url = new URL(`${ORIGIN}/api/v1/vacancies/`);
  url.searchParams.set('limit', '20');
  url.searchParams.set('all_catalog', 'true');
  url.searchParams.set(param, value);
  const r = await json(url.toString());
  const rows = items(r.body);
  probes.push({
    param,
    status: r.status,
    total: r.body?.total ?? null,
    count: rows.length,
    unique_company_ids: [...new Set(rows.map(v => v.company_id).filter(v => v !== undefined))],
    first: rows.slice(0, 3).map(v => ({ id: v.id, company_id: v.company_id, company_name: v.company_name, title: v.title, url: v.url })),
  });
}

const statuses = new Map();
for (const company of companies) {
  const key = String(company.parse_status ?? 'null');
  const row = statuses.get(key) || { status: key, count: 0, vacancy_count_sum: 0, samples: [] };
  row.count += 1;
  row.vacancy_count_sum += Number(company.vacancy_count || 0);
  if (row.samples.length < 8) {
    row.samples.push({
      id: company.id,
      name: company.name,
      career_url: company.career_url,
      vacancy_count: company.vacancy_count,
      parse_status_message: company.parse_status_message,
    });
  }
  statuses.set(key, row);
}

const report = {
  generated_at: new Date().toISOString(),
  company_count: companies.length,
  target_company: {
    id: target.id,
    name: target.name,
    career_url: target.career_url,
    vacancy_count: target.vacancy_count,
    parse_status: target.parse_status,
    parse_status_message: target.parse_status_message,
  },
  status_summary: [...statuses.values()],
  probes,
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
