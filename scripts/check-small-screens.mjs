#!/usr/bin/env node
/**
 * Реальный browser-guard для маленьких экранов.
 *
 * Запускается после Expo web export. Поднимает dist/ локально, глушит внешний
 * мир и отдаёт детерминированные ответы db.php, затем открывает ключевые
 * экраны в Chromium на 320 и 360 px. Проверяем именно геометрию DOM после
 * рендера: document/body не должны становиться шире viewport.
 *
 * На ошибке сохраняются PNG в .small-screen-artifacts/ — workflow прикладывает
 * их как artifact, чтобы было видно, что именно вылезло за экран.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(process.env.SMALL_SCREEN_ROOT || 'dist');
const OUT = path.resolve(process.env.SMALL_SCREEN_OUT || '.small-screen-artifacts');
const PORT = Number(process.env.SMALL_SCREEN_PORT || 8098);
const WIDTHS = (process.env.SMALL_SCREEN_WIDTHS || '320,360')
  .split(',')
  .map(v => Number(v.trim()))
  .filter(v => Number.isFinite(v) && v >= 280);
const HEIGHT = Number(process.env.SMALL_SCREEN_HEIGHT || 800);
const TOLERANCE = 2;

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  throw new Error(`Нет ${path.join(ROOT, 'index.html')} — сначала соберите Expo web`);
}
if (!WIDTHS.length) throw new Error('Не задано ни одной допустимой ширины viewport');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const now = new Date('2026-09-15T09:00:00Z');
const iso = d => d.toISOString();
const worker = {
  id: 'small-w1', role: 'worker', phone: '79990000001',
  first_name: 'Максим', last_name: 'Фёдоров', age: 28,
  metro_line_id: 'arb', metro_station: 'Митино', work_types: ['stocker'],
  company: null, created_at: iso(now), is_blocked: false, avatar_url: null,
  avg_rating: 4.9, rating_count: 12, password: '123456',
  bio: 'Работал на складах, есть опыт сборки и приёмки.', last_seen_at: iso(now),
  resume_data: {
    desiredPosition: 'Региональный менеджер', salary: '140 000 ₽ на руки',
    specializations: ['Директор магазина, директор сети магазинов', 'Супервайзер'],
    employmentType: 'полная занятость', workFormat: 'удалённо', city: 'Москва',
    experience: [
      { company: 'ООО «Яндекс Лавка»', position: 'Супервайзер', start: 'Август 2022', end: 'настоящее время', duration: '4 года 2 месяца', description: 'Организация работы склада, управление персоналом и запасами.' },
      { company: 'ООО «Яндекс Лавка»', position: 'Директор склада', start: 'Сентябрь 2021', end: 'Июль 2022', duration: '11 месяцев' },
    ],
    education: [{ level: 'Среднее образование' }],
    skills: ['MS Excel', 'Управление командой', 'Управление персоналом', 'WMS'],
    languages: [{ name: 'Русский', level: 'Родной' }, { name: 'Английский', level: 'A2 — Элементарный' }],
    sourceFileName: 'resume.pdf', importedAt: iso(now),
  },
  resume_file_name: 'resume.pdf', resume_imported_at: iso(now),
};
const employer = {
  id: 'small-e1', role: 'employer', phone: '79990000002',
  first_name: 'Сергей', last_name: 'Манолий', metro_line_id: 'arb',
  metro_station: 'Пятницкое шоссе', work_types: [], company: 'Лавка',
  created_at: iso(now), is_blocked: false, avatar_url: null,
  avg_rating: 5, rating_count: 3, password: '123456',
  bio: 'Дарксторы в Москве.', last_seen_at: iso(now),
};
const vacancy = {
  id: 'small-v1', employer_id: employer.id, company: 'Лавка',
  title: 'Кладовщик-сборщик', work_type: 'stocker', work_type_label: 'Кладовщик',
  metro_line_id: 'arb', metro_station: 'Пятницкое шоссе', date: '2026-09-16',
  time_start: '07:00', time_end: '16:00', salary: 2830,
  norms_and_pay: 'Нормативы:\n— Сборка товара\n— Размещение товара',
  address: '11, Пятницкая улица, городской округ Красногорск',
  lat: 55.8567, lng: 37.3547, workers_needed: 3, workers_found: 1,
  is_urgent: true, no_experience_needed: true,
  conditions: 'Форма выдаётся, обед за счёт компании', status: 'open',
  created_at: iso(now),
};
const perm = {
  id: 'small-p1', employer_id: employer.id, company: 'Лавка',
  title: 'Кладовщик на постоянную работу', work_type: 'stocker',
  metro_line_id: 'arb', metro_station: 'Митино',
  address: 'Митинская улица, 36, Москва', lat: 55.8457, lng: 37.3622,
  salary: 80000, schedule: '5/2 07:00–16:00',
  description: 'Приёмка, размещение и учёт товара в дарксторе. Оформление по ТК.',
  status: 'open', created_at: iso(now),
};
const messages = [
  { id: 'small-m1', chat_id: 'small-c1', sender_id: employer.id,
    text: 'Здравствуйте! Подтвердите, пожалуйста, выход завтра к 07:00.',
    created_at: iso(new Date(now.getTime() - 600000)) },
  { id: 'small-m2', chat_id: 'small-c1', sender_id: worker.id,
    text: 'Здравствуйте! Да, буду вовремя.', created_at: iso(now) },
];
const chat = {
  id: 'small-c1', vacancy_id: vacancy.id, worker_id: worker.id,
  employer_id: employer.id, vac_title: vacancy.title, company_name: vacancy.company,
  unread_worker: 1, unread_employer: 0, created_at: iso(now),
  messages, is_locked: false,
};

function toAppUser(r) {
  return {
    id: r.id, role: r.role, phone: r.phone, lastName: r.last_name,
    firstName: r.first_name, age: r.age ?? undefined,
    metroLineId: r.metro_line_id ?? undefined,
    metroStation: r.metro_station ?? undefined,
    workTypes: r.work_types ?? [], company: r.company ?? undefined,
    createdAt: r.created_at, isBlocked: false, avatarUrl: undefined,
    avgRating: r.avg_rating, ratingCount: r.rating_count,
    password: r.password, bio: r.bio, lastSeenAt: r.last_seen_at,
    resume: r.resume_data ? {
      ...r.resume_data,
      sourceFileName: r.resume_file_name ?? r.resume_data.sourceFileName,
      importedAt: r.resume_imported_at ?? r.resume_data.importedAt,
    } : undefined,
  };
}

function dbResponse(fn, args) {
  switch (fn) {
    case 'dbCheckPhoneExists': return false;
    case 'dbGetUsers': return [worker, employer];
    case 'dbGetUserById': return [worker, employer].find(u => u.id === args?.[0]) ?? null;
    case 'dbGetVacancies': return [vacancy];
    case 'dbGetVacanciesByEmployer': return [vacancy];
    case 'dbGetPermVacancies': return [perm];
    case 'dbGetPermVacanciesByEmployer': return [perm];
    case 'dbGetVacancyStatsMap': return { [vacancy.id]: { applicants: 2, rejected: 0, views: 7 } };
    case 'dbGetPermVacancyViewsMap': return { [perm.id]: 5 };
    case 'dbGetLikes':
    case 'dbGetLikesForUser':
    case 'dbGetPermApplications':
    case 'dbGetRatingsForUser':
    case 'dbGetActiveBulletins':
    case 'dbGetMyBulletins': return [];
    case 'dbGetChats': return [chat];
    case 'dbGetChatById': return chat;
    case 'dbGetMessages': return messages;
    case 'dbGetNotifications': return [];
    case 'dbGetUnreadNotifCount': return 1;
    case 'dbGetPermSaved': return [];
    case 'dbAutoClosePastVacancies': return 0;
    case 'dbWarmup': return true;
    case 'dbAddressSuggest': return [
      { title: 'Митинская улица, 36, Москва', lat: 55.8457, lng: 37.3622 },
    ];
    default: return [];
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serve() {
  return http.createServer((req, res) => {
    const clean = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = clean === '/' ? '/index.html' : clean;
    let file = path.join(ROOT, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const html = file.replace(/\/$/, '') + '.html';
      file = fs.existsSync(html) ? html : path.join(ROOT, 'index.html');
    }
    try {
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  }).listen(PORT, '127.0.0.1');
}

const screens = [
  { id: 'login', url: '/login' },
  { id: 'register-worker', url: '/register-worker' },
  { id: 'register-employer', url: '/register-employer' },
  { id: 'worker-feed', url: '/(tabs)/feed', who: worker, wait: 3500 },
  { id: 'worker-matches', url: '/(tabs)/matches', who: worker },
  { id: 'worker-chats', url: '/(tabs)/chats', who: worker },
  { id: 'chat-room', url: '/chat-room?chatId=small-c1', who: worker },
  { id: 'worker-profile', url: '/(tabs)/profile', who: worker },
  { id: 'perm-detail', url: '/perm-vacancy-detail?vacancyId=small-p1', who: worker },
  { id: 'employer-feed', url: '/(tabs)/feed', who: employer, wait: 3500 },
  { id: 'create-shift', url: '/create-vacancy', who: employer },
  { id: 'create-perm', url: '/create-perm-vacancy', who: employer },
];

async function inspectLayout(page) {
  return page.evaluate((tolerance) => {
    const html = document.documentElement;
    const body = document.body;
    const overflow = Math.max(html?.scrollWidth || 0, body?.scrollWidth || 0) - window.innerWidth;

    // Fixed/sticky controls cannot be recovered by horizontal scrolling, so a
    // clipped one is a genuine usability defect even when scrollWidth is OK.
    const clippedFixed = [];
    for (const el of document.querySelectorAll('button,a,input,textarea,select,[role="button"]')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= window.innerHeight) continue;
      if (r.left < -tolerance || r.right > window.innerWidth + tolerance) {
        clippedFixed.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80),
          left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        });
      }
    }
    return {
      viewport: window.innerWidth,
      htmlScrollWidth: html?.scrollWidth || 0,
      bodyScrollWidth: body?.scrollWidth || 0,
      overflow: Math.round(overflow),
      clippedFixed,
    };
  }, TOLERANCE);
}

const server = serve();
const browser = await chromium.launch({ headless: true });
const failures = [];
const checked = [];

try {
  for (const width of WIDTHS) {
    for (const screen of screens) {
      const context = await browser.newContext({
        viewport: { width, height: HEIGHT },
        locale: 'ru-RU', timezoneId: 'Europe/Moscow', deviceScaleFactor: 1,
      });
      await context.route('**', async route => {
        const url = route.request().url();
        const local = url.startsWith(`http://127.0.0.1:${PORT}`);
        if (url.includes('/api/db.php')) {
          let payload = {};
          try { payload = JSON.parse(route.request().postData() || '{}'); } catch {}
          return route.fulfill({
            status: 200, contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ data: dbResponse(payload.fn, payload.args) }),
          });
        }
        if (local) return route.continue();
        return route.fulfill({ status: 204, body: '' });
      });

      const page = await context.newPage();
      if (screen.who) {
        await page.addInitScript(user => {
          localStorage.setItem('jm_currentUser', JSON.stringify(user));
          localStorage.setItem(`jm_onboarding_v3_${user.id}`, JSON.stringify({ status: 'done', step: 999 }));
          localStorage.setItem('jm_notif_prompt_choice', 'enabled');
        }, toAppUser(screen.who));
      }

      const key = `${width}-${screen.id}`;
      try {
        await page.goto(`http://127.0.0.1:${PORT}${screen.url}`, {
          waitUntil: 'domcontentloaded', timeout: 30000,
        });
        await page.waitForTimeout(screen.wait || 2200);
        await page.evaluate(() => { try { window.__hideSplash?.(); } catch {} });
        await page.waitForTimeout(700);

        const layout = await inspectLayout(page);
        checked.push({ key, ...layout });
        if (layout.overflow > TOLERANCE || layout.clippedFixed.length) {
          const png = path.join(OUT, `${key}.png`);
          await page.screenshot({ path: png, fullPage: true });
          failures.push({ key, ...layout, screenshot: png });
        }
      } catch (error) {
        const png = path.join(OUT, `${key}-error.png`);
        await page.screenshot({ path: png, fullPage: true }).catch(() => {});
        failures.push({ key, error: String(error?.message || error), screenshot: png });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ checked, failures }, null, 2) + '\n');
console.log(`small-screen: проверено ${checked.length} состояний (${WIDTHS.join(', ')} px)`);
if (failures.length) {
  console.error(`small-screen: ПРОВАЛЫ ${failures.length}`);
  for (const f of failures) {
    if (f.error) console.error(` - ${f.key}: ${f.error}`);
    else console.error(` - ${f.key}: overflow=${f.overflow}px fixed=${JSON.stringify(f.clippedFixed)}`);
  }
  process.exit(1);
}
console.log('small-screen: OK — горизонтального overflow нет');
