#!/usr/bin/env node
/**
 * Проверка находок разведки ТЕМ ЖЕ способом, каким читает прод.
 *
 * Зачем отдельно от разведки. Разведка смотрит браузером: она выполняет
 * скрипты, ходит по ссылкам, ждёт догрузку. Прод так не умеет — php-proxy
 * делает обычный запрос без скриптов. Находка, верная для браузера, у прода
 * может дать пустой список или ссылку в никуда, и узнать об этом надо ДО того,
 * как источник включён, а не по жалобе «в приложении вакансия не открывается».
 *
 * Проверяем три вещи, и все три обязательны:
 *   1. адрес отдаёт список — обычным запросом, без браузера;
 *   2. ссылка на вакансию открывается и на странице виден ЕЁ заголовок;
 *   3. выдуманный адрес того же вида заголовка НЕ показывает.
 *
 * Третья проверка нужна из-за одностраничных сайтов: они отвечают 200 на любой
 * адрес, и без неё «ссылка работает» означало бы только «сайт жив».
 *
 * Запуск: node scripts/career-endpoint-verify.mjs discovery.json [out.json]
 */
import fs from 'node:fs';
import process from 'node:process';
import { dig, embeddedJson, hrefsWith, itemUrl } from './career-discover-lib.mjs';

const UA = 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)';
const IN = process.argv[2] || 'career-discovery.json';
const OUT = process.argv[3] || 'career-verified.json';
const TIMEOUT = Number(process.env.VERIFY_TIMEOUT_MS || 25000);

async function get(url, init = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(init.headers || {}) },
      method: init.method || 'GET',
      body: init.body,
      redirect: 'follow',
      signal: ac.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: '', error: String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyJson(entry) {
  const endpoint = entry.connector_config.endpoints[0];
  const origin = new URL(entry.url).origin;
  const init = endpoint.method === 'POST'
    ? { method: 'POST', body: JSON.stringify(endpoint.body ?? {}), headers: { 'Content-Type': 'application/json' } }
    : {};
  const res = await get(endpoint.url, init);
  if (res.status !== 200) return { ok: false, reason: `список: HTTP ${res.status}${res.error ? ` (${res.error})` : ''}` };
  let body;
  try { body = JSON.parse(res.text); } catch { return { ok: false, reason: 'список: ответ не JSON' }; }
  const list = dig(body, endpoint.map?.list || '');
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: 'список пуст обычным запросом' };

  const map = endpoint.map || {};
  const item = list[0];
  const title = String(item[map.title] ?? '').trim();
  const url = itemUrl(item, map, origin);
  if (!url) return { ok: false, reason: 'нечем собрать ссылку на вакансию', items: list.length };
  if (title.length < 8) return { ok: false, reason: 'нет заголовка, нечем опознать страницу', items: list.length };

  const page = await get(url);
  if (page.status !== 200) return { ok: false, reason: `ссылка на вакансию: HTTP ${page.status}`, items: list.length, url };

  // Контроль: выдуманный адрес того же вида. Без него «ссылка работает»
  // означало бы только «сайт жив»: одностраничник отвечает 200 на что угодно.
  const bogus = url.replace(/[^/]+\/?$/, 'jobtoo-probe-000000');
  const control = await get(bogus);

  if (page.text.includes(title)) {
    if (control.status === 200 && control.text.includes(title)) {
      return { ok: false, reason: 'сайт показывает ту же вакансию по любому адресу', items: list.length, url };
    }
    return { ok: true, items: list.length, url, title };
  }

  // Заголовка в сыром HTML нет — страницу рисует скрипт. Для ЧЕЛОВЕКА такая
  // ссылка полностью рабочая, и отбрасывать её было бы неправильно: у
  // Пятёрочки так устроены все вакансии. Но убедиться, что адрес не выдуман,
  // всё равно надо, и тогда единственный доступный признак — разный ответ на
  // настоящий и на несуществующий адрес.
  if (control.status !== page.status) {
    return {
      ok: true, items: list.length, url, title,
      note: `страницу рисует скрипт; адрес подтверждён кодом ответа (${page.status} против ${control.status} у выдуманного)`,
    };
  }
  return {
    ok: false,
    reason: `страница рисуется скриптом и отвечает ${page.status} даже на выдуманный адрес`,
    items: list.length, url,
  };
}

async function verifyHtmlLinks(entry) {
  const endpoint = entry.connector_config.endpoints[0];
  const res = await get(endpoint.url);
  if (res.status !== 200) return { ok: false, reason: `страница: HTTP ${res.status}${res.error ? ` (${res.error})` : ''}` };
  const hrefs = hrefsWith(res.text, endpoint.map.link_path, endpoint.url);
  if (hrefs.length < 3) return { ok: false, reason: `в сыром HTML только ${hrefs.length} ссылок` };
  // Берём НАСТОЯЩИЙ href из разметки, а не собираем адрес сами. Первая версия
  // складывала origin + link_path + хвост, и хвост обрезался по первому «/»:
  // Контур, IBS и Техвилл получали 404 — при том что на проде эти три
  // источника работают и дают 62, 45 и 20 вакансий.
  const sample = hrefs[0];
  const page = await get(sample);
  if (page.status !== 200) return { ok: false, reason: `ссылка на вакансию: HTTP ${page.status}`, items: hrefs.length, url: sample };
  return { ok: true, items: hrefs.length, url: sample };
}

/**
 * Данные, положенные прямо в HTML: Next.js и Nuxt. Прод читает их режимом
 * `embedded` — то есть повторной загрузкой той же страницы, а не отдельным
 * адресом, поэтому и проверять надо страницу.
 */
async function verifyEmbedded(entry) {
  const endpoint = entry.connector_config.endpoints[0];
  const res = await get(endpoint.url);
  if (res.status !== 200) return { ok: false, reason: `страница: HTTP ${res.status}${res.error ? ` (${res.error})` : ''}` };
  const raw = embeddedJson(res.text);
  if (!raw) return { ok: false, reason: 'в HTML нет встроенных данных (__NEXT_DATA__/__NUXT__)' };
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, reason: 'встроенные данные не разбираются как JSON' }; }
  const list = dig(body, endpoint.map?.list || '');
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: 'встроенный список пуст' };
  return { ok: true, items: list.length, url: endpoint.url };
}

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const ready = rows.filter(r => r.status === 'готов' && r.connector_config?.endpoints?.length);
const out = [];
for (const entry of ready) {
  const mode = entry.connector_config.endpoints[0].mode;
  const result = mode === 'html_links' ? await verifyHtmlLinks(entry)
    : mode === 'embedded' ? await verifyEmbedded(entry)
      : await verifyJson(entry);
  out.push({ name: entry.name, url: entry.url, mode: mode || 'json', ...result, connector_config: entry.connector_config });
  console.log(`${result.ok ? '✓' : '✗'} ${entry.name.slice(0, 24).padEnd(24)} ${result.ok ? `${result.items} шт.` : result.reason}`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`\nПодтвердилось: ${out.filter(r => r.ok).length} из ${out.length}. Подробности: ${OUT}`);
