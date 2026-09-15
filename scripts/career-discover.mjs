#!/usr/bin/env node
/**
 * Разведка карьерных сайтов: найти, откуда страница берёт вакансии.
 *
 * Зачем. Карьерные сайты работодателей почти сплошь SPA: `curl` получает пустую
 * оболочку, а вакансии подгружает скрипт. Проверено на тридцати крупнейших
 * российских компаниях — разметки schema.org/JobPosting нет НИ У ОДНОЙ, а
 * перебор типовых путей к API дал один рабочий источник. Подробности и цифры —
 * в docs/источники-вакансий-разбор.md.
 *
 * Конкурент cofinder решает это браузером: в его собственном ответе у
 * Альфа-Банка лежит Selenium stacktrace. Но держать браузер в бою дорого, и у
 * него же 15 парсеров из 111 сломаны.
 *
 * Здесь браузер работает ОДИН РАЗ на компанию и только ради разведки: открывает
 * страницу, слушает её сетевые запросы и находит настоящий адрес, откуда
 * приходят вакансии. Дальше этот адрес живёт в настройке источника, а прод
 * читает его обычным curl — тем самым разбором, что уже есть в
 * php-proxy/career_feed.php (cf_json_items). То же, что делает человек с
 * DevTools, только само и по списку.
 *
 * Запуск:
 *   node scripts/career-discover.mjs                     # список из cofinder
 *   node scripts/career-discover.mjs sites.txt           # свой список, по адресу в строке
 *   node scripts/career-discover.mjs https://job.x.ru/   # один сайт
 *
 * Настройки через окружение:
 *   DISCOVER_LIMIT=30      сколько компаний взять из списка (по умолчанию 30)
 *   DISCOVER_OUT=путь      куда писать результат (по умолчанию career-discovery.json)
 *   DISCOVER_PAUSE_MS=1500 пауза между сайтами; меньше 500 не ставить
 *   DISCOVER_TIMEOUT_MS    ожидание страницы, по умолчанию 30000
 *
 * Про вежливость к чужим сайтам. Идём последовательно, с паузой, честным
 * User-Agent и адресом поддержки. Открываем одну страницу на компанию. Из
 * ответов берём только СТРУКТУРУ — имена полей и количество, — а не содержимое
 * вакансий: цель разведки узнать, где данные, а не собрать их.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { findLists, guessMap, URL_SHAPES } from './career-discover-lib.mjs';
import process from 'node:process';

const LIMIT = Number(process.env.DISCOVER_LIMIT || 30);
const OUT = process.env.DISCOVER_OUT || 'career-discovery.json';
const PAUSE = Math.max(500, Number(process.env.DISCOVER_PAUSE_MS || 1500));
const TIMEOUT = Number(process.env.DISCOVER_TIMEOUT_MS || 30000);
const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';

/**
 * Проверить догадку об адресе вакансии.
 *
 * Ссылки в ответе часто нет — есть slug или id, а адрес собирается на клиенте.
 * Правило «нет ссылки на первоисточник — вакансию не берём» стоит и в
 * cf_normalize, и в cf_json_items, поэтому шаблон адреса надо не угадать, а
 * проверить: подставляем значение и смотрим, отвечает ли страница.
 */
async function probeUrlTemplate(page, origin, sample, map) {
  const direct = map.url && typeof sample[map.url] === 'string' ? sample[map.url] : '';
  if (/^https:\/\//i.test(direct)) return { url_template: '', checked: direct, ok: true };

  const idField = map.id || 'id';
  const value = sample[idField];
  if (value === undefined || value === null || value === '') return { ok: false };

  for (const shape of URL_SHAPES) {
    const candidate = origin + shape.replace('{v}', encodeURIComponent(String(value)));
    try {
      const res = await page.request.get(candidate, { timeout: 12000, maxRedirects: 3 });
      if (res.status() === 200) {
        return { url_template: origin + shape.replace('{v}', `{${idField}}`), checked: candidate, ok: true };
      }
    } catch { /* следующий вариант */ }
  }
  return { ok: false };
}

/** Список карьерных сайтов: из аргумента, из файла или из каталога cofinder. */
async function loadTargets(arg) {
  if (arg && /^https?:\/\//i.test(arg)) return [{ name: new URL(arg).hostname, url: arg }];
  if (arg && fs.existsSync(arg)) {
    return fs.readFileSync(arg, 'utf8').split('\n').map(s => s.trim()).filter(s => /^https?:\/\//i.test(s))
      .map(u => ({ name: new URL(u).hostname, url: u }));
  }
  // По умолчанию берём каталог конкурента: там 160 компаний вместе с адресами
  // их карьерных сайтов, и это готовый перечень, а не догадки.
  const res = await fetch('https://cofinder.ru/api/v1/companies/?limit=500', {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`каталог компаний не отвечает: HTTP ${res.status}`);
  const list = await res.json();
  const rows = Array.isArray(list) ? list : (list.items || []);
  return rows
    .filter(c => (c.country_codes || [])[0] === 'RU' && c.career_url)
    .sort((a, b) => (b.vacancy_count || 0) - (a.vacancy_count || 0))
    .slice(0, LIMIT)
    .map(c => ({ name: c.name, url: c.career_url }));
}

const targets = await loadTargets(process.argv[2]);
console.log(`Разведка: ${targets.length} сайт(ов), пауза ${PAUSE} мс\n`);

const browser = await chromium.launch({ headless: true });
const results = [];

for (const [i, target] of targets.entries()) {
  const label = `${String(i + 1).padStart(3)}. ${target.name.slice(0, 22).padEnd(22)}`;
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Копим ответы, похожие на JSON. Тело читаем сразу: после перехода на
  // следующую страницу оно уже недоступно.
  const captured = [];
  page.on('response', async res => {
    try {
      const type = res.headers()['content-type'] || '';
      if (!type.includes('json')) return;
      const url = res.url();
      if (/analytics|metrika|sentry|gtm|counter|pixel/i.test(url)) return;
      const body = await res.json();
      captured.push({ url, body });
    } catch { /* не JSON или ответ уже ушёл */ }
  });

  let entry = { name: target.name, url: target.url, status: 'нет данных' };
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    // Ждём догрузку: вакансии почти всегда приходят отдельным запросом уже
    // после того, как разметка готова.
    await page.waitForTimeout(4000);

    // Сначала сетевые ответы, затем — состояние страницы. Второе спасает те
    // сайты, что кладут данные прямо в HTML (Next.js, Nuxt): сетевого запроса
    // там нет вовсе.
    let best = null;
    for (const cap of captured) {
      for (const found of findLists(cap.body)) {
        if (!best || found.count > best.count) best = { ...found, endpoint: cap.url, from: 'запрос' };
      }
    }
    if (!best) {
      const embedded = await page.evaluate(() => {
        const out = [];
        const next = document.getElementById('__NEXT_DATA__');
        if (next?.textContent) out.push(next.textContent);
        for (const key of ['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__']) {
          const value = window[key];
          if (value) { try { out.push(JSON.stringify(value)); } catch { /* циклы */ } }
        }
        return out;
      });
      for (const raw of embedded) {
        let data; try { data = JSON.parse(raw); } catch { continue; }
        for (const found of findLists(data)) {
          if (!best || found.count > best.count) best = { ...found, endpoint: '(в HTML страницы)', from: 'HTML' };
        }
      }
    }

    if (best) {
      const origin = new URL(target.url).origin;
      const map = guessMap(best.sample);
      const probe = await probeUrlTemplate(page, origin, best.sample, map);
      if (probe.url_template) map.url_template = probe.url_template;
      // Догадка про ссылку не подтвердилась — честно говорим об этом: без
      // адреса вакансии источник включать нельзя, коннектор её отбросит.
      entry = {
        name: target.name, url: target.url,
        status: probe.ok ? 'готов' : 'нет адреса вакансии',
        source: best.from, endpoint: best.endpoint, count: best.count,
        list_path: best.path, fields: Object.keys(best.sample).slice(0, 20),
        connector_config: probe.ok
          ? { endpoints: [{ url: best.endpoint, map: { list: best.path, ...map } }] }
          : null,
      };
      console.log(`${label} ${probe.ok ? '✓' : '~'} ${best.count} вакансий, ${best.from}: ${String(best.endpoint).slice(0, 70)}`);
      if (!probe.ok) console.log(`${' '.repeat(28)}адрес вакансии не подтверждён — нужен вручную`);
    } else {
      console.log(`${label} — вакансий не видно`);
    }
  } catch (e) {
    entry.status = 'ошибка';
    entry.error = String(e.message || e).slice(0, 120);
    console.log(`${label} ! ${entry.error}`);
  }

  results.push(entry);
  await context.close();
  if (i < targets.length - 1) await sleep(PAUSE);
}

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');

const ready = results.filter(r => r.status === 'готов');
const partial = results.filter(r => r.status === 'нет адреса вакансии');
console.log(`\nГотовых источников: ${ready.length} из ${results.length}`);
if (partial.length) console.log(`Нашлись, но без адреса вакансии: ${partial.length}`);
console.log(`Подробности: ${OUT}`);

if (ready.length) {
  console.log('\nЧто вписать в connector_config источника career:\n');
  console.log(JSON.stringify({ endpoints: ready.flatMap(r => r.connector_config.endpoints) }, null, 1));
  console.log('\nПеред включением источника посмотрите глазами, что он отдаёт.');
}
