#!/usr/bin/env node
/**
 * Проверка ссылок у вакансий, которые прямо сейчас лежат в production-ленте.
 *
 * Требование владельца дословно: «source_url должен вести на конкретную живую
 * вакансию, а не просто на главную карьерного сайта». Разведка и проверялка
 * смотрят источник ДО включения; здесь смотрим то, что уже видит человек в
 * приложении.
 *
 * Считаем сломанной ссылку, которая: не отвечает 200; уводит редиректом на
 * корень сайта (классическая «вакансия закрылась, держите главную»); ведёт на
 * агрегатор, а не на домен работодателя.
 *
 * Запуск: node scripts/career-links-audit.mjs [сколько на компанию]
 */
import process from 'node:process';
import fs from 'node:fs';

const REST = process.env.AUDIT_REST || 'https://jobtoo.ru/rest/v1/jm_ext_vacancies';
const SOURCE = process.env.AUDIT_SOURCE || 'career_owner';
const PER_COMPANY = Number(process.argv[2] || process.env.AUDIT_PER_COMPANY || 2);
const OUT = process.env.AUDIT_OUT || 'career-links-audit.json';
const UA = 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)';
const AGGREGATORS = /(^|\.)(hh\.ru|rabota\.by|superjob\.ru|avito\.ru|zarplata\.ru|career\.habr\.com)$/i;

const query = new URLSearchParams({
  select: 'company,title,url,source_id',
  source_id: `eq.${SOURCE}`,
  active: 'is.true',
  limit: '5000',
});
const rows = await (await fetch(`${REST}?${query}`, { headers: { 'User-Agent': UA } })).json();
if (!Array.isArray(rows)) {
  console.error('лента не отдалась:', JSON.stringify(rows).slice(0, 200));
  process.exit(1);
}

// По несколько штук на компанию, а не первые N подряд: иначе вся выборка
// уходит в METRO, у которой вакансий больше, чем у всех остальных вместе.
const byCompany = new Map();
for (const row of rows) {
  const list = byCompany.get(row.company) || [];
  if (list.length < PER_COMPANY) list.push(row);
  byCompany.set(row.company, list);
}
const sample = [...byCompany.values()].flat();
console.log(`В ленте ${rows.length} вакансий, ${byCompany.size} компаний. Проверяем ${sample.length}.\n`);

const out = [];
for (const row of sample) {
  const verdict = await check(row);
  out.push({ ...row, ...verdict });
  if (!verdict.ok) console.log(`✗ ${String(row.company).slice(0, 20).padEnd(20)} ${verdict.reason}  ${row.url}`);
}

async function check(row) {
  const url = String(row.url || '');
  if (!/^https:\/\//.test(url)) return { ok: false, reason: 'нет ссылки' };
  let target;
  try { target = new URL(url); } catch { return { ok: false, reason: 'ссылка не разбирается' }; }
  if (AGGREGATORS.test(target.hostname)) return { ok: false, reason: 'ведёт на агрегатор' };
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  } catch (e) {
    return { ok: false, reason: `не открылась: ${String(e.message || e).slice(0, 40)}` };
  }
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  const landed = new URL(res.url);
  // Редирект на корень — это «вакансии больше нет, вот вам главная». Для
  // человека выглядит как поломка приложения, а не как закрытая вакансия.
  if (landed.pathname.replace(/\/+$/, '') === '' && target.pathname.replace(/\/+$/, '') !== '') {
    return { ok: false, reason: 'редирект на главную' };
  }
  return { ok: true, landed: res.url };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
const bad = out.filter(r => !r.ok);
console.log(`\nЖивых ссылок: ${out.length - bad.length} из ${out.length}. Подробности: ${OUT}`);
if (bad.length) process.exitCode = 1;
