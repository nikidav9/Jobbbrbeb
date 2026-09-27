#!/usr/bin/env node
/**
 * Разовый замер: что увидит на анкетах отклика настоящий браузер.
 *
 * Зачем. Ежедневная разведка Jupiter (jupiter/recon.py) ходит без браузера и
 * на части сайтов упирается в два класса:
 *   spa     — анкету рисует скрипт, движок её не видит;
 *   captcha — анкета заполнена целиком, но в ней капча.
 * Решение владельца 27.09.2026: прежде чем решать, пускать ли Chromium в бой,
 * измерить — сколько spa-сайтов в браузере показывают анкету и какая капча
 * стоит на captcha-сайтах (видимая, невидимая, страница-проверка).
 *
 * Только чтение. Скрипт ничего не вводит и не отправляет: в коде нет ни
 * fill, ни type, ни submit. Единственное действие — нажать видимую кнопку
 * «Откликнуться», если анкета открывается по ней. На всякий случай любой
 * переход страницы не GET-запросом (так уходит форма) обрывается.
 * Капчу не решает и не обходит: только отмечает, какая она.
 * Подпись честная, как у недельной разведки (scripts/career-discover.mjs).
 *
 * Запуск — на московском сервере в образе Playwright (infra/browser-probe-run.sh):
 *   PROBE_RECON=/var/www/html/jupiter-recon.json PROBE_OUT=out.json node browser-probe.mjs
 * Итог — список по сайтам и сводка; ничего о людях.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; JobToo/1.0; +https://jobtoo.ru; support@jobtoo.ru)';
const RECON = process.env.PROBE_RECON || '/var/www/html/jupiter-recon.json';
const OUT = process.env.PROBE_OUT || 'browser-probe.json';
const CLASSES = (process.env.PROBE_CLASSES || 'spa,captcha').split(',');
const CONCURRENCY = Math.min(4, Number(process.env.PROBE_CONCURRENCY || 3));
const TIMEOUT = Number(process.env.PROBE_TIMEOUT_MS || 30000);
const SETTLE = Number(process.env.PROBE_SETTLE_MS || 4000);

// Поля, по которым видно анкету кандидата, а не поиск или подписку.
const CANDIDATE = [
  ['email', /e-?mail|почт/i],
  ['phone', /phone|tel|телефон/i],
  ['name', /name|fio|имя|фамили|фио/i],
  ['resume', /resume|cv|резюме/i],
];
const APPLY_TEXT = /^(откликнуться|отклик|подать (заявку|отклик)|отправить резюме|apply( now)?|respond)$/i;
const CAPTCHA_SRC = [
  ['recaptcha', /google\.com\/recaptcha|recaptcha\.net|gstatic\.com\/recaptcha/i],
  ['smartcaptcha', /smartcaptcha\.yandexcloud\.net|captcha-api\.yandex/i],
  ['hcaptcha', /hcaptcha\.com/i],
  ['turnstile', /challenges\.cloudflare\.com/i],
];
const CHALLENGE_PAGE = /just a moment|checking your browser|ddos-guard|qrator|проверка браузера|вы не робот/i;

/** Всё, что видно в одном фрейме: поля анкеты и следы капчи. */
async function scanFrame(frame) {
  return frame.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const fields = [];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      if (type !== 'file' && !visible(el)) continue;
      const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      fields.push({
        type,
        hint: [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('autocomplete'), label, el.getAttribute('aria-label')]
          .filter(Boolean).join(' ').slice(0, 120),
        in_form: !!el.closest('form'),
      });
    }
    const captcha = [];
    for (const el of document.querySelectorAll('.g-recaptcha, .grecaptcha-badge, .smart-captcha, .h-captcha, .cf-turnstile, [data-sitekey]')) {
      captcha.push({ cls: el.className && String(el.className).slice(0, 60), visible: visible(el),
        invisible_attr: el.getAttribute('data-size') === 'invisible' || el.hasAttribute('data-invisible') });
    }
    const scripts = [...document.scripts].map(s => s.src).filter(Boolean);
    return { fields, captcha, scripts, title: document.title };
  }).catch(() => ({ fields: [], captcha: [], scripts: [], title: '' }));
}

async function scanPage(page) {
  const frames = [];
  for (const frame of page.frames()) {
    const data = await scanFrame(frame);
    let host = '';
    try { host = new URL(frame.url()).hostname; } catch { /* about:blank */ }
    // Размер фрейма нужен, чтобы отличить видимый виджет капчи от невидимого.
    let box = null;
    try { box = frame === page.mainFrame() ? null : await (await frame.frameElement()).boundingBox(); } catch { /* отцеплен */ }
    frames.push({ url: frame.url(), host, box, ...data });
  }
  return frames;
}

function candidateKinds(frames) {
  const kinds = new Set();
  for (const f of frames) for (const field of f.fields) {
    if (field.type === 'file') kinds.add('resume');
    if (field.type === 'email') kinds.add('email');
    if (field.type === 'tel') kinds.add('phone');
    for (const [kind, re] of CANDIDATE) if (re.test(field.hint)) kinds.add(kind);
  }
  return [...kinds].sort();
}

function captchaKind(frames) {
  const vendors = new Set();
  let visible = false;
  let invisible = false;
  for (const f of frames) {
    for (const [vendor, re] of CAPTCHA_SRC) {
      if (re.test(f.url)) {
        vendors.add(vendor);
        // Видимый чекбокс или картинка — фрейм заметного размера; бейдж
        // невидимой reCAPTCHA и служебные фреймы — крошечные или скрытые.
        if (f.box && f.box.width >= 150 && f.box.height >= 50) visible = true;
        else invisible = true;
      }
      if (f.scripts.some(s => re.test(s))) vendors.add(vendor);
    }
    for (const c of f.captcha) {
      if (c.invisible_attr || /grecaptcha-badge/.test(c.cls || '')) invisible = true;
      else if (c.visible) visible = true;
    }
    if (f.fields.some(x => /captcha|капч/i.test(x.hint))) { vendors.add('своя'); visible = true; }
  }
  const kind = visible ? 'visible' : invisible ? 'invisible' : vendors.size ? 'script_only' : 'none';
  return { kind, vendors: [...vendors].sort() };
}

function verdict(site) {
  if (site.error) return 'error';
  if (site.challenge_page) return 'challenge_page';
  const enough = site.candidate_fields.length >= 2;
  if (!enough) return 'no_form';
  if (site.captcha.kind === 'visible') return 'form_visible_captcha';
  if (site.captcha.kind === 'invisible' || site.captcha.kind === 'script_only') return 'form_invisible_captcha';
  return 'form_no_captcha';
}

async function probe(browser, item) {
  const url = item.final_url || item.start_url || item.url;
  const started = Date.now();
  const site = { name: item.name, recon_klass: item.klass, url, http: null, apply_clicked: false,
    blocked_submits: 0, candidate_fields: [], widget_hosts: [], captcha: { kind: 'none', vendors: [] },
    challenge_page: false, error: '' };
  const context = await browser.newContext({ userAgent: UA, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  await context.route('**/*', route => {
    const req = route.request();
    const type = req.resourceType();
    // Страховка «только чтение»: переход документа не GET — это отправка формы.
    if (type === 'document' && !['GET', 'HEAD'].includes(req.method())) {
      site.blocked_submits += 1;
      return route.abort();
    }
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    site.http = res ? res.status() : null;
    await page.waitForLoadState('networkidle', { timeout: SETTLE * 2 }).catch(() => {});
    await page.waitForTimeout(SETTLE);
    let frames = await scanPage(page);
    site.challenge_page = CHALLENGE_PAGE.test(frames[0]?.title || '');
    if (candidateKinds(frames).length < 2 && !site.challenge_page) {
      // Анкета часто открывается кнопкой. Жмём только явную «Откликнуться»,
      // и только если это не кнопка отправки формы.
      const buttons = page.locator('a, button, [role=button]').filter({ hasText: APPLY_TEXT });
      const count = await buttons.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 5); i++) {
        const b = buttons.nth(i);
        const isSubmit = await b.evaluate(el => el.getAttribute('type') === 'submit' && !!el.closest('form')).catch(() => true);
        if (isSubmit || !(await b.isVisible().catch(() => false))) continue;
        await b.click({ timeout: 5000 }).catch(() => {});
        site.apply_clicked = true;
        await page.waitForLoadState('networkidle', { timeout: SETTLE * 2 }).catch(() => {});
        await page.waitForTimeout(SETTLE);
        frames = await scanPage(page);
        break;
      }
    }
    site.candidate_fields = candidateKinds(frames);
    site.captcha = captchaKind(frames);
    const own = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    site.widget_hosts = [...new Set(frames.filter(f => f.fields.length && f.host && f.host !== own).map(f => f.host))];
    site.final_url = page.url();
  } catch (err) {
    site.error = String(err && err.message || err).split('\n')[0].slice(0, 200);
  } finally {
    await context.close().catch(() => {});
  }
  site.verdict = verdict(site);
  site.ms = Date.now() - started;
  return site;
}

const recon = JSON.parse(fs.readFileSync(RECON, 'utf8'));
const targets = recon.filter(r => CLASSES.includes(r.klass));
console.log(`Замер: ${targets.length} сайт(ов) классов ${CLASSES.join(', ')}, по ${CONCURRENCY}`);

// Путь к браузеру — окружением, как в career-discover.mjs: пусто — Playwright ищет сам.
const BROWSER_PATH = process.env.PROBE_BROWSER || '';
const browser = await chromium.launch({ headless: true, ...(BROWSER_PATH ? { executablePath: BROWSER_PATH } : {}) });
const results = [];
let next = 0;
async function worker() {
  while (next < targets.length) {
    const item = targets[next++];
    const site = await probe(browser, item);
    results.push(site);
    console.log(`${String(results.length).padStart(3)}/${targets.length} ${site.verdict.padEnd(22)} ${site.name}`);
    fs.writeFileSync(OUT + '.partial', JSON.stringify({ partial: true, sites: results }, null, 1));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();

const summary = {};
for (const klass of CLASSES) {
  summary[klass] = {};
  for (const s of results.filter(r => r.recon_klass === klass)) {
    summary[klass][s.verdict] = (summary[klass][s.verdict] || 0) + 1;
  }
}
fs.writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  recon_file_mtime: fs.statSync(RECON).mtime.toISOString(),
  user_agent: UA,
  summary,
  sites: results.sort((a, b) => a.recon_klass.localeCompare(b.recon_klass) || a.name.localeCompare(b.name, 'ru')),
}, null, 1));
fs.rmSync(OUT + '.partial', { force: true });
console.log('Сводка:', JSON.stringify(summary));
