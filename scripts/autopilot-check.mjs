#!/usr/bin/env node
/**
 * Стенд автопилота отклика (services/jupiterAutopilot.ts) на живых сайтах.
 *
 * Открывает страницу вакансии в Chromium, вставляет тот же скрипт, что
 * приложение вставит во встроенный браузер на телефоне, и печатает итог —
 * СУХОЙ прогон: submit=false зашит, «Отправить» не нажимается. Вдобавок любой
 * переход документа не GET обрывается, как в scripts/browser-probe.mjs.
 * Профиль — синтетический кандидат, резюме — крошечный PDF-заглушка.
 *
 *   node --experimental-strip-types scripts/autopilot-check.mjs <url> [<url> …]
 *   AUTOPILOT_BROWSER=/path/to/chrome — свой Chromium (как PROBE_BROWSER)
 *   AUTOPILOT_NODE_FETCH=1 — запросы через Node (облачный контейнер с прокси)
 *
 * Итог по каждому адресу — одна строка JSON в stdout.
 */
import { chromium } from 'playwright';
import { buildAutopilotScript } from '../services/jupiterAutopilot.ts';
import { fillHostFor } from '../services/jupiterFill.ts';

const PROFILE = {
  first_name: 'Тест', last_name: 'Проверкин', patronymic: 'Иванович',
  full_name: 'Проверкин Тест Иванович', phone: '+79990000000',
  email: 'jupiter-test@jobtoo.ru', city: 'Москва', citizenship: 'Россия',
  desired_role: 'Разработчик',
  cover_letter: 'Здравствуйте! Интересна ваша вакансия, резюме прилагаю.',
};
// Минимальный корректный PDF: страница без содержимого.
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');

const urls = process.argv.slice(2);
if (!urls.length) { console.error('укажите адреса'); process.exit(2); }

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AUTOPILOT_BROWSER ? { executablePath: process.env.AUTOPILOT_BROWSER } : {}),
});

for (const url of urls) {
  const host = fillHostFor(url);
  const out = { url, host, blocked_submits: 0 };
  if (!host) { console.log(JSON.stringify({ ...out, outcome: 'error', reason: 'not_https' })); continue; }
  const context = await browser.newContext({
    // Как WebView на Android: обычная мобильная подпись браузера.
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  });
  await context.route('**/*', route => {
    const req = route.request();
    if (req.resourceType() === 'document' && !['GET', 'HEAD'].includes(req.method())) {
      out.blocked_submits++;
      return route.abort().catch(() => {});
    }
    // В облачном контейнере Chromium не доверяет сертификату прокси; тогда
    // запросы страницы выполняет Node-сторона Playwright (AUTOPILOT_NODE_FETCH=1).
    if (process.env.AUTOPILOT_NODE_FETCH === '1') {
      // Контекст мог закрыться раньше ответа — тогда запрос уже никому не нужен.
      return route.fetch().then(r => route.fulfill({ response: r })).catch(() => route.abort().catch(() => {}));
    }
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  let resolveResult;
  const result = new Promise(r => { resolveResult = r; });
  await page.exposeFunction('__jtPost', msg => {
    try { const m = JSON.parse(msg); if (m.type === 'jt-autopilot') resolveResult(m); } catch { /* чужое */ }
  });
  const script = buildAutopilotScript(PROFILE, host, {
    submit: false, delegated: true, resumeBase64: PDF, resumeName: 'resume.pdf', deadlineMs: 45000,
  });
  // Подмена моста WebView и вставка на каждой странице, как injectedJavaScript.
  await page.addInitScript(`window.ReactNativeWebView = { postMessage: function (m) { window.__jtPost(m); } };`);
  await page.addInitScript(script);
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    out.http = res ? res.status() : null;
    const r = await Promise.race([result, new Promise(r => setTimeout(() => r({ outcome: 'timeout' }), 55000))]);
    Object.assign(out, r);
  } catch (err) {
    Object.assign(out, { outcome: 'error', reason: String(err?.message || err).split('\n')[0].slice(0, 160) });
  }
  console.log(JSON.stringify(out));
  await context.close();
}
await browser.close();
