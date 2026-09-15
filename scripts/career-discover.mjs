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
 *   node scripts/career-discover.mjs                     # свой список career-sites.tsv
 *   node scripts/career-discover.mjs sites.tsv           # другой список: Название<TAB>адрес
 *   node scripts/career-discover.mjs https://job.x.ru/   # один сайт
 *
 * Настройки через окружение:
 *   DISCOVER_LIMIT=0       сколько компаний взять из списка (0 — весь)
 *   DISCOVER_OUT=путь      куда писать результат (по умолчанию career-discovery.json)
 *   DISCOVER_CONCURRENCY=5 сколько сайтов смотрим одновременно (максимум 8)
 *   DISCOVER_SETTLE_MS     сколько ждать догрузку вакансий, по умолчанию 5000
 *   DISCOVER_TIMEOUT_MS    ожидание страницы, по умолчанию 30000
 *   DISCOVER_PAUSE_MS=0    пауза после сайта; нужна, только если хост общий
 *
 * Про вежливость к чужим сайтам. На каждую компанию — ОДИН заход, и
 * параллелим мы разные сайты, а не запросы к одному: пауза защищала бы от
 * долбёжки одного хоста, здесь её роль играет ограничение параллельности.
 * User-Agent честный, с адресом поддержки. Картинки и шрифты не качаем вовсе.
 * Из ответов берём только СТРУКТУРУ — имена полей и количество, — а не
 * содержимое вакансий: цель разведки узнать, где данные, а не собрать их.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { findLists, guessMap, parseSiteList, URL_SHAPES } from './career-discover-lib.mjs';
import process from 'node:process';

// Сколько компаний брать. Пусто или 0 — весь список: своих сайтов 62, и
// прежний предел в 30 молча отрезал бы половину.
const LIMIT = Number(process.env.DISCOVER_LIMIT || 0) || Infinity;
const OUT = process.env.DISCOVER_OUT || 'career-discovery.json';
// Сколько сайтов смотрим одновременно. Пауза между сайтами защищала бы от
// долбёжки ОДНОГО хоста, но мы ходим по разным: на каждый всё равно один заход.
// Поэтому вместо паузы — ограниченная параллельность.
const CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.DISCOVER_CONCURRENCY || 5)));
const PAUSE = Math.max(0, Number(process.env.DISCOVER_PAUSE_MS || 0));
const TIMEOUT = Number(process.env.DISCOVER_TIMEOUT_MS || 30000);
// Сколько ждать догрузку вакансий после готовности разметки. Выходим раньше,
// как только список найден, — это и есть основная экономия времени.
const SETTLE_MS = Number(process.env.DISCOVER_SETTLE_MS || 5000);
const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';
// Свой список компаний. Путь считаем от файла скрипта, а не от рабочего
// каталога: запускают его и из корня репозитория, и из Actions.
const OWN_LIST = new URL('./career-sites.tsv', import.meta.url).pathname;
// Сколько признаков вакансии (деньги, место, обязанности, график, работодатель)
// должно быть в записи, чтобы считать список вакансиями. См. scoreList.
const MIN_EVIDENCE = Number(process.env.DISCOVER_MIN_EVIDENCE || 2);

/** Пауза между сайтами: ходим по чужим серверам, а не долбим их подряд. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Проверить догадку об адресе вакансии.
 *
 * Ссылки в ответе часто нет — есть slug или id, а адрес собирается на клиенте.
 * Правило «нет ссылки на первоисточник — вакансию не берём» стоит и в
 * cf_normalize, и в cf_json_items, поэтому шаблон адреса надо не угадать, а
 * проверить: подставляем значение и смотрим, отвечает ли страница.
 */
async function probeUrlTemplate(context, origin, sample, map) {
  const direct = map.url && typeof sample[map.url] === 'string' ? sample[map.url] : '';
  if (/^https:\/\//i.test(direct)) return { url_template: '', checked: direct, ok: true };

  // Проверяем адрес БРАУЗЕРОМ, а не запросом. Прежняя проверка смотрела на код
  // ответа, и на одностраничных сайтах это не значило ничего: job.rt.ru отдаёт
  // 26 КБ своей оболочки и на выдуманный /vacancy/jobtoo-probe-404 — замерено.
  // От этого разом шло и ложное «готов» (адрес подтверждался у кого угодно), и
  // ложное «нет адреса» у Сбера и Lamoda, где страница вакансии есть, но её
  // рисует скрипт. Признак настоящей страницы один: на ней виден заголовок
  // именно этой вакансии, а на выдуманном адресе — нет.
  const titleField = map.title;
  const title = titleField ? String(sample[titleField] ?? '').trim() : '';
  if (title.length < 8) return { ok: false, reason: 'нечем опознать страницу вакансии' };

  const probePage = await context.newPage();
  const render = async url => {
    try {
      await probePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await probePage.waitForTimeout(1500);
      return await probePage.evaluate(() => document.body?.innerText || '');
    } catch { return null; }
  };
  try {
    // Контроль: что показывает сайт по заведомо несуществующему адресу. Если
    // там уже есть наш заголовок, сайт показывает одно и то же везде.
    const bogus = (await render(`${origin}/vacancy/jobtoo-probe-404`)) || '';
    if (bogus.includes(title)) return { ok: false, reason: 'сайт показывает одно и то же по любому адресу' };

    // Slug в адресе встречается чаще числового id, поэтому пробуем оба.
    const fields = [map.id || 'id', 'slug', 'id'].filter((f, i, a) => a.indexOf(f) === i);
    for (const idField of fields) {
      const value = sample[idField];
      if (value === undefined || value === null || value === '') continue;
      for (const shape of URL_SHAPES) {
        const candidate = origin + shape.replace('{v}', encodeURIComponent(String(value)));
        const text = await render(candidate);
        if (text && text.includes(title)) {
          return { url_template: origin + shape.replace('{v}', `{${idField}}`), checked: candidate, ok: true };
        }
      }
    }
  } finally {
    try { await probePage.close(); } catch { /* вкладка уже мертва */ }
  }
  return { ok: false };
}

/** Список карьерных сайтов: из аргумента, из файла или свой из репозитория. */
async function loadTargets(arg) {
  if (arg && /^https?:\/\//i.test(arg)) return [{ name: new URL(arg).hostname, url: arg }];
  if (arg && fs.existsSync(arg)) return parseSiteList(fs.readFileSync(arg, 'utf8')).slice(0, LIMIT);
  // По умолчанию — свой список (scripts/career-sites.tsv). Каталог cofinder
  // тоже перечень компаний, но его категории сплошь офисно-айтишные: в
  // «Логистике» у него ноль вакансий, поиск по «комплектовщик» пуст. Для
  // раздела «Подработка» он бесполезен, а наш список собран под оба раздела.
  if (fs.existsSync(OWN_LIST)) return parseSiteList(fs.readFileSync(OWN_LIST, 'utf8')).slice(0, LIMIT);
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
console.log(`Разведка: ${targets.length} сайт(ов), по ${CONCURRENCY} одновременно\n`);

const browser = await chromium.launch({ headless: true });
const results = [];

/** Разведка одного сайта. Ошибка здесь — строка в отчёте, а не конец прогона. */
async function inspect(target, i) {
  const label = `${String(i + 1).padStart(3)}. ${target.name.slice(0, 22).padEnd(22)}`;
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Картинки, шрифты, видео и рекламу не грузим вовсе. Нас интересуют только
  // данные, а на карьерных страницах именно тяжёлые ресурсы занимают почти всё
  // время загрузки. Правило на контексте, а не на вкладке: его должна унаследовать
  // и вкладка, которой проверяется адрес вакансии.
  await context.route('**/*', route => {
    const type = route.request().resourceType();
    // Стили НЕ блокируем: экономия от них мала, а часть сайтов без CSS
    // рендерится иначе или не рендерится вовсе. Режем только заведомо
    // бесполезное для разведки.
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    if (/analytics|metrika|gtm|doubleclick|adservice|sentry/i.test(route.request().url())) return route.abort();
    return route.continue();
  });

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
    // Ждём догрузку, но не вслепую: как только в перехваченных ответах появился
    // список вакансий, ждать оставшееся время незачем. На быстрых сайтах это
    // экономит по три-четыре секунды на каждом.
    for (let waited = 0; waited < SETTLE_MS; waited += 250) {
      if (captured.some(c => findLists(c.body).length)) break;
      await page.waitForTimeout(250);
    }

    // Смотрим И сетевые ответы, И состояние страницы. Второе спасает сайты,
    // кладущие данные прямо в HTML (Next.js, Nuxt), а перебирать оба источника
    // надо всегда: у сайта может быть и справочник в запросе, и вакансии в HTML.
    let best = null;
    const consider = (found, endpoint, from) => {
      const candidate = { ...found, endpoint, from };
      if (!best || candidate.score > best.score
        || (candidate.score === best.score && candidate.count > best.count)) best = candidate;
    };
    for (const cap of captured) {
      for (const found of findLists(cap.body)) consider(found, cap.url, 'запрос');
    }
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
      for (const found of findLists(data)) consider(found, '(в HTML страницы)', 'HTML');
    }
    // Один признак вакансии или ноль — это справочник, а не вакансии. Прогон по
    // 111 компаниям дал четыре таких «находки» из семи: города, категории,
    // меню шапки, направления. Лучше честное «не нашли», чем источник-пустышка.
    if (best && best.score < MIN_EVIDENCE) {
      console.log(`${label} — нашёлся только справочник (${best.count} шт., ${best.path || 'корень'})`);
      best = null;
    }

    if (best) {
      const origin = new URL(target.url).origin;
      const map = guessMap(best.sample);
      const probe = await probeUrlTemplate(context, origin, best.sample, map);
      if (probe.url_template) map.url_template = probe.url_template;
      // Догадка про ссылку не подтвердилась — честно говорим об этом: без
      // адреса вакансии источник включать нельзя, коннектор её отбросит.
      entry = {
        name: target.name, url: target.url,
        status: probe.ok ? 'готов' : 'нет адреса вакансии',
        source: best.from, endpoint: best.endpoint, count: best.count,
        evidence: best.score,
        list_path: best.path, fields: Object.keys(best.sample).slice(0, 20),
        ...(probe.ok ? {} : { url_note: probe.reason || 'ни один типовой адрес не подошёл' }),
        connector_config: probe.ok
          ? { endpoints: [{ url: best.endpoint, map: { list: best.path, ...map } }] }
          : null,
      };
      console.log(`${label} ${probe.ok ? '✓' : '~'} ${best.count} вакансий, ${best.from}: ${String(best.endpoint).slice(0, 70)}`);
      if (!probe.ok) console.log(`${' '.repeat(28)}адрес не подтверждён: ${probe.reason || 'типовые пути не подошли'}`);
    } else {
      console.log(`${label} — вакансий не видно`);
    }
  } catch (e) {
    entry.status = 'ошибка';
    entry.error = String(e.message || e).slice(0, 120);
    console.log(`${label} ! ${entry.error}`);
  }

  results.push(entry);
  // Пишем после каждого сайта, а не в конце. Первый прогон упал на середине, и
  // артефакт не сохранился вовсе — при том что по Сберу результат уже был.
  try { fs.writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8'); } catch { /* допишем в конце */ }
  try { await context.close(); } catch { /* вкладка уже мертва */ }
}

// Пул из CONCURRENCY работников разбирает общую очередь. Пауза между сайтами не
// нужна: заходов к одному хосту всё равно один, а параллелим мы разные.
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
  while (cursor < targets.length) {
    const i = cursor++;
    await inspect(targets[i], i);
    if (PAUSE) await sleep(PAUSE);
  }
}));

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
