// Снимает настоящие экраны приложения для макета.
//
// Живой сервер из песочницы недоступен, поэтому веб-сборка поднимается
// локально, а все обращения к jobtoo.ru/api/db.php перехватываются и
// отвечают заранее заготовленными данными. Рисует при этом настоящее
// приложение: те же компоненты, цвета, шрифты и отступы, что у людей.
//
//   npx expo export -p web --output-dir .figma-export
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//        scripts/shoot-screens.mjs
//
// Флаг нужен, чтобы импортировать настоящий constants/legal.ts: штамп согласия
// должен приезжать из кода, а не переписываться сюда руками. Переписанный
// однажды разойдётся с документами, и снимки молча станут окном «Примите
// документы» — ровно так уже случилось с сессией.
//
// Результат: docs/screens/*.png

// playwright стоит глобально, а не в зависимостях проекта — берём по пути
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
// Штамп действующей редакции документов. Не копия и не константа: ConsentGate
// сравнивает ответ сервера именно с этим значением.
import { LEGAL_STAMP } from '../constants/legal.ts';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.figma-export');
const OUT = path.resolve('docs/screens');
const VEC = path.resolve('docs/screens-vector');
const PORT = 8099;
const VW = 390, VH = 844;

// ─── Данные-заглушки ────────────────────────────────────────────────────
const NOW = new Date();  // фикстуры считаем от текущего дня
const iso = (d) => d.toISOString();
const dayISO = (off) => {
  const d = new Date(NOW); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const WORKER = {
  id: 'w1', role: 'worker', phone: '79161572834',
  first_name: 'Максим', last_name: 'Фёдоров', age: 28,
  metro_line_id: 'arb', metro_station: 'Митино',
  work_types: ['stocker'], company: null, created_at: iso(NOW),
  is_blocked: false, avatar_url: null, avg_rating: 4.9, rating_count: 12,
  password: '123456', bio: 'Работал на складах Лавки, есть опыт сборки и приёмки.',
  telegram_id: null, last_seen_at: iso(NOW),
};
const EMPLOYER = {
  id: 'e1', role: 'employer', phone: '79990001122',
  first_name: 'Сергей', last_name: 'Манолий',
  metro_line_id: 'arb', metro_station: 'Пятницкое шоссе',
  work_types: null, company: 'Лавка', created_at: iso(NOW),
  is_blocked: false, avatar_url: null, avg_rating: 5, rating_count: 1,
  password: '123456', bio: 'Дарксторы Лавки в Северо-Западном округе.',
  telegram_id: null, last_seen_at: iso(NOW),
};
const USERS = [WORKER, EMPLOYER];

const ADDR = '11, Пятницкая улица, Отрадное, городской округ Красногорск';
const vac = (i, over = {}) => ({
  id: `v${i}`, employer_id: 'e1', company: 'Лавка', title: 'Кладовщик',
  work_type: 'stocker', work_type_label: 'Кладовщик',
  metro_line_id: 'arb', metro_station: 'Пятницкое шоссе',
  date: dayISO(1), time_start: '07:00', time_end: '16:00',
  salary: 2830, norms_and_pay: `📍 Адрес: ${ADDR}\nНормативы:\n— Сборка товара: 2.83 ₽\n— Размещение товара: 1.05 ₽\n— Размещение маркета: 1.19 ₽\n— Размещение мороза: 1.2 ₽\n— Размещение многоштучки: 4.29 ₽\n— НПО: 399 ₽`,
  address: ADDR, lat: 55.8567, lng: 37.3547,
  workers_needed: 3, workers_found: 1, is_urgent: true,
  no_experience_needed: true, conditions: 'Форма выдаётся, обед за счёт компании',
  status: 'open', created_at: iso(NOW), ...over,
});
const VACANCIES = [
  vac(1),
  vac(2, { id: 'v2', title: 'Сборщик', work_type: 'stocker', time_start: '10:00', time_end: '19:00', is_urgent: false, salary: 3100 }),
  vac(3, { id: 'v3', title: 'Кладовщик', date: dayISO(2), metro_station: 'Митино', salary: 2900 }),
];

const PERM = [
  {
    id: 'p1', employer_id: 'e1', company: 'Лавка', title: 'Кладовщик',
    work_type: 'stocker', metro_line_id: 'fil', metro_station: 'Пионерская',
    address: '1/28, улица Полосухина, район Фили-Давыдково, Москва',
    lat: 55.7305, lng: 37.4880, salary: 80000, schedule: '5/2 07:00-16:00',
    description: 'Приёмка, размещение и учёт товара в дарксторе. Оформление по ТК.',
    status: 'open', created_at: iso(NOW),
  },
  {
    id: 'p2', employer_id: 'e1', company: 'Лавка', title: 'Старший смены',
    work_type: 'shift_supervisor', metro_line_id: 'arb', metro_station: 'Митино',
    address: 'Митинская улица, 36, Москва', lat: 55.8457, lng: 37.3622,
    salary: 95000, schedule: '2/2 08:00-20:00',
    description: 'Управление сменой, контроль показателей.',
    status: 'open', created_at: iso(NOW),
  },
];

const MSGS = [
  { id: 'm1', chat_id: 'c1', sender_id: 'e1', text: 'Здравствуйте! Был ли у вас опыт работы в Лавке?', created_at: iso(new Date(NOW.getTime() - 3600e3)) },
  { id: 'm2', chat_id: 'c1', sender_id: 'w1', text: 'Здравствуйте! Да, работал сборщиком полгода.', created_at: iso(new Date(NOW.getTime() - 3400e3)) },
  { id: 'm3', chat_id: 'c1', sender_id: 'e1', text: 'Отлично. Подтвердите, пожалуйста, выход Сб 25.07 к 07:00.', created_at: iso(new Date(NOW.getTime() - 600e3)) },
];
const CHATS = [{
  id: 'c1', vacancy_id: 'v1', worker_id: 'w1', employer_id: 'e1',
  vac_title: 'Кладовщик', company_name: 'Лавка',
  unread_worker: 0, unread_employer: 0, created_at: iso(NOW),
  messages: MSGS, is_locked: false,
}];

const LIKES = [{
  id: 'l1', vacancy_id: 'v1', worker_id: 'w1', employer_id: 'e1',
  worker_liked: true, employer_liked: true, worker_skipped: false,
  is_match: true, matched_at: iso(NOW), worker_confirmed: false,
  employer_confirmed: false, shift_completed: false, cancelled: false,
}];

const NOTIFS = [
  { id: 'n1', user_id: 'w1', title: '⚡ Новая подработка!', body: 'Кладовщик — Лавка, 25 июля 07:00–16:00, м. Пятницкое шоссе. Открой и откликнись!', is_read: false, created_at: iso(NOW), type: 'nearby_shift', payload: null },
  { id: 'n2', user_id: 'w1', title: '💬 Сергей Манолий', body: 'Подтвердите, пожалуйста, выход Сб 25.07 к 07:00.', is_read: false, created_at: iso(new Date(NOW.getTime() - 600e3)), type: 'message', payload: { chatId: 'c1' } },
];

const BULLETINS = [{
  id: 'b1', employer_id: 'e1', company: 'Лавка', work_type: 'Сборка заказов',
  date: dayISO(1), time_start: '18:00', time_end: '23:00',
  metro: 'Пятницкое шоссе', address: ADDR, lat: 55.8567, lng: 37.3547,
  comment: 'Нужен один человек на вечер, оплата в конце смены.',
  status: 'open', created_at: iso(NOW),
}];

const RATINGS = [{
  id: 'r1', from_user_id: 'e1', to_user_id: 'w1', rating: 5,
  review_text: 'Пришёл вовремя, работал быстро. Возьму снова.',
  role: 'employer', created_at: iso(NOW),
}];

// Ответ на любой вызов прокси
// Кто «вошёл» в текущем снимке. Приложение с осени проверяет сессию на
// сервере (AppContext → dbRestoreSession → dbSession): кэш профиля в
// localStorage входом больше не считается. Без ответа на dbSession снимок
// выходил экраном выбора роли — и так вышли ВСЕ 35 снимков, потому что
// заглушка про эту функцию не знала.
let CURRENT = null;

function respond(fn, args) {
  switch (fn) {
    case 'dbSession': return CURRENT ? { user: CURRENT } : null;
    // Согласие принято текущей редакцией: иначе ConsentGate закрывает экран
    // окном «Примите документы», и снимок показывает его, а не приложение.
    case 'dbGetConsent':
      return CURRENT
        ? { stamp: LEGAL_STAMP, docs: {}, source: 'screenshot', accepted_at: iso(NOW) }
        : null;
    case 'dbGetUsers': return USERS;
    case 'dbCheckPhoneExists': return false;
    case 'dbGetUserById': return USERS.find(u => u.id === args?.[0]) ?? null;
    case 'dbGetVacancies': return VACANCIES;
    case 'dbGetPermVacancies': return PERM;
    case 'dbGetLikes': return LIKES;
    case 'dbGetLikesForUser': return LIKES;
    case 'dbGetLikeByVacancyWorker': return LIKES[0];
    case 'dbGetVacancyStatsMap': return { v1: { applicants: 3, rejected: 0, views: 9 }, v2: { applicants: 1, rejected: 0, views: 4 }, v3: { applicants: 0, rejected: 0, views: 2 } };
    case 'dbGetPermVacancyViewsMap': return { p1: 9, p2: 4 };
    case 'dbGetPermVacanciesByEmployer': return PERM;
    case 'dbGetVacanciesByEmployer': return VACANCIES;
    case 'dbGetMyBulletins': return BULLETINS;
    case 'dbAutoClosePastVacancies': return 0;
    case 'dbWarmup': return true;
    case 'dbGetChats': return CHATS;
    case 'dbGetChatById': return CHATS[0];
    case 'dbGetMessages': return MSGS;
    case 'dbGetNotifications': return NOTIFS;
    case 'dbGetActiveBulletins': return BULLETINS;
    case 'dbGetRatingsForUser': return RATINGS;
    case 'dbGetPermSaved': return ['p2'];
    case 'dbGetPermApplications': return [
      { id: 'pa1', vacancy_id: 'p1', worker_id: 'w1', employer_id: 'e1', status: 'pending', created_at: iso(NOW) },
    ];
    case 'dbGetVacancyStats': return { applicants: 3, rejected: 0, views: 9 };
    case 'dbGetPermVacancyViews': return { p1: 9, p2: 4 };
    case 'dbGetVacancyViews': return { v1: 9, v2: 4, v3: 2 };
    case 'dbAddressSuggest': return [
      { title: ADDR, lat: 55.8567, lng: 37.3547 },
      { title: 'Митинская улица, 36, Москва', lat: 55.8457, lng: 37.3622 },
    ];
    case 'dbGetUnreadNotifCount': return 2;
    default: return [];
  }
}

// ─── Проходы по многошаговым экранам ────────────────────────────────────
// Регистрация — это один маршрут с внутренним состоянием шага, по ссылке
// на конкретный шаг не попасть. Поэтому проходим форму как человек:
// заполняем и жмём «Продолжить».
const type = async (page, label, value) => {
  const box = page.locator(`text=${label}`).first();
  await box.waitFor({ timeout: 5000 }).catch(() => {});
  const input = page.locator('input, textarea').nth(await inputIndexNear(page, label));
  await input.fill(value);
};

async function inputIndexNear(page, label) {
  return page.evaluate((lbl) => {
    const nodes = Array.from(document.querySelectorAll('input, textarea'));
    const all = Array.from(document.querySelectorAll('*'));
    const anchor = all.find(e => e.children.length === 0 && (e.textContent || '').trim() === lbl);
    if (!anchor) return 0;
    const ay = anchor.getBoundingClientRect().top;
    let best = 0, bestD = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.abs(n.getBoundingClientRect().top - ay);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }, label);
}

const clickText = async (page, text) => {
  const el = page.locator(`text=${text}`).first();
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
};

/** Регистрация работника: 6 шагов */
async function walkRegisterWorker(page, snap) {
  await snap('register-worker-1');
  await page.locator('input').first().fill('9990001122');
  await page.waitForTimeout(300);
  await clickText(page, 'Продолжить');

  await snap('register-worker-2');
  const pass = page.locator('input');
  await pass.nth(0).fill('123456');
  await pass.nth(1).fill('123456');
  await clickText(page, 'Продолжить');

  await snap('register-worker-3');
  await page.locator('input').nth(0).fill('Фёдоров');
  await page.locator('input').nth(1).fill('Максим');
  await clickText(page, 'Продолжить');

  await snap('register-worker-4');          // согласие с документами
  // Галочка — не <input>, а нарисованный квадрат внутри строки. Жмём по
  // нему по координатам, мимо ссылок на документы в тексте рядом.
  await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll('div'))
      .find(d => {
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        return r.width >= 18 && r.width <= 30 && Math.abs(r.width - r.height) < 3
          && parseFloat(cs.borderTopWidth) > 0 && d.children.length === 0;
      });
    if (box) box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await clickText(page, 'Продолжить');

  await snap('register-worker-5');          // метро
  await clickText(page, 'Выбрать станцию');
  await snap('register-worker-5-picker');  // выбор станции — отдельное окно
  await clickText(page, 'Арбатско-Покровская');
  await page.waitForTimeout(500);
  await clickText(page, 'Митино');
  await page.waitForTimeout(600);
  await snap('register-worker-5-chosen');
  await clickText(page, 'Продолжить');

  await snap('register-worker-6');          // резюме
  await clickText(page, 'Пропустить — выберу разделы сам');
}

/** Регистрация работодателя: 4 шага */
async function walkRegisterEmployer(page, snap) {
  await snap('register-employer-1');
  await page.locator('input').first().fill('9990003344');
  await page.waitForTimeout(300);
  await clickText(page, 'Продолжить');

  await snap('register-employer-2');
  await page.locator('input').nth(0).fill('123456');
  await page.locator('input').nth(1).fill('123456');
  await clickText(page, 'Продолжить');

  await snap('register-employer-3');
  await page.locator('input').nth(0).fill('Манолий');
  await page.locator('input').nth(1).fill('Сергей');
  await clickText(page, 'Лавка');
  await clickText(page, 'Продолжить');

  await snap('register-employer-4');
}

// ─── Экраны для съёмки ──────────────────────────────────────────────────
// who: под каким пользователем открывать (null — гость)
const SHOTS = [
  { id: 'index', url: '/', who: null, title: 'Стартовый экран', wait: 3500 },
  { id: 'login', url: '/login', who: null, title: 'Вход' },
  { id: 'register-worker', url: '/register-worker', who: null, title: 'Регистрация работника', walk: walkRegisterWorker },
  { id: 'register-employer', url: '/register-employer', who: null, title: 'Регистрация работодателя', walk: walkRegisterEmployer },

  { id: 'feed-shift', url: '/(tabs)/feed', who: WORKER, title: 'Поиск · Смены', wait: 3000 },
  { id: 'matches', url: '/(tabs)/matches', who: WORKER, title: 'Мои отклики' },
  { id: 'exchange', url: '/(tabs)/exchange', who: WORKER, title: 'Биржа' },
  { id: 'chats', url: '/(tabs)/chats', who: WORKER, title: 'Сообщения' },
  { id: 'profile', url: '/(tabs)/profile', who: WORKER, title: 'Профиль работника' },

  { id: 'chat-room', url: '/chat-room?chatId=c1', who: WORKER, title: 'Чат' },
  { id: 'perm-vacancy-detail', url: '/perm-vacancy-detail?vacancyId=p1', who: WORKER, title: 'Вакансия' },
  { id: 'user-profile', url: '/user-profile?userId=e1', who: WORKER, title: 'Профиль работодателя' },
  { id: 'legal', url: '/legal?doc=terms', who: WORKER, title: 'Документы' },
  { id: 'rate', url: '/rate?likeId=l1&toUserId=e1&role=worker', who: WORKER, title: 'Оценка смены' },
  { id: 'match', url: '/match?vacancyId=v1', who: WORKER, title: 'Мэтч' },

  { id: 'feed-employer', url: '/(tabs)/feed', who: EMPLOYER, title: 'Кабинет работодателя', wait: 3000 },
  { id: 'matches-employer', url: '/(tabs)/matches', who: EMPLOYER, title: 'Отклики · работодатель' },
  { id: 'profile-employer', url: '/(tabs)/profile', who: EMPLOYER, title: 'Профиль работодателя' },
  { id: 'create-vacancy', url: '/create-vacancy', who: EMPLOYER, title: 'Создание смены' },
  { id: 'create-perm-vacancy', url: '/create-perm-vacancy', who: EMPLOYER, title: 'Создание вакансии' },
  { id: 'perm-applications', url: '/perm-applications', who: EMPLOYER, title: 'Отклики на вакансии' },
  { id: 'candidates', url: '/candidates?vacancyId=v1', who: EMPLOYER, title: 'Кандидаты' },
];

// ─── Статика ────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const html = file.replace(/\/$/, '') + '.html';
      file = fs.existsSync(html) ? html : path.join(ROOT, 'index.html');
    }
    try {
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end('nope');
    }
  }).listen(PORT);
}

// Строка → объект приложения (в localStorage лежит уже camelCase-форма)
function toAppUser(r) {
  return {
    id: r.id, role: r.role, phone: r.phone, lastName: r.last_name, firstName: r.first_name,
    age: r.age ?? undefined, metroLineId: r.metro_line_id ?? undefined,
    metroStation: r.metro_station ?? undefined, workTypes: r.work_types ?? [],
    company: r.company ?? undefined, createdAt: r.created_at, isBlocked: false,
    avatarUrl: undefined, avgRating: r.avg_rating, ratingCount: r.rating_count,
    password: r.password, bio: r.bio, lastSeenAt: r.last_seen_at,
  };
}

const srv = serve();
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(VEC, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const shotIds = [];

for (const shot of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });

  // Весь внешний мир глушим одним обработчиком: в Playwright позже
  // зарегистрированный маршрут перекрывает ранний, поэтому два отдельных
  // правила («всё» и «api/db.php») конфликтовали и запросы к API уходили
  // в сеть, которой из песочницы нет.
  await ctx.route('**', async route => {
    const url = route.request().url();
    const local = url.startsWith(`http://127.0.0.1:${PORT}`) || url.startsWith(`http://localhost:${PORT}`);

    if (url.includes('/api/db.php')) {
      let body = {};
      try { body = JSON.parse(route.request().postData() ?? '{}'); } catch {}
      if (process.env.LOG_FNS) console.log('   fn:', body.fn);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: respond(body.fn, body.args) }),
      });
    }
    if (local) return route.continue();
    // карты, телеграм-виджет, аналитика — пустая заглушка
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });

  const page = await ctx.newPage();
  CURRENT = null;
  if (shot.who) {
    CURRENT = shot.who;
    await page.addInitScript((u) => {
      try {
        window.localStorage.setItem('jm_currentUser', JSON.stringify(u));
        // На вебе токен лежит в AsyncStorage (то есть в обычном localStorage):
        // SecureStore включается только на телефоне. Без токена
        // dbRestoreSession возвращает null, не дойдя до сервера.
        window.localStorage.setItem('jm_session_token', 'shot-token');
        // Обучалка и предложение включить уведомления перекрывают экран —
        // помечаем пройденными, снимок должен показывать сам интерфейс
        window.localStorage.setItem(`jm_onboarding_v3_${u.id}`, JSON.stringify({ status: 'done', step: 999 }));
        window.localStorage.setItem('jm_notif_prompt_choice', 'enabled');
        // «Заполните профиль до конца» — та же история, что обучалка: окно
        // поверх экрана, помечаем показанным.
        window.localStorage.setItem('jm_complete_profile_prompt_v1', '1');
      } catch {}
    }, toAppUser(shot.who));
  }

  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));

  try {
    await page.goto(`http://127.0.0.1:${PORT}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(shot.wait ?? 2600);
    // Статичный веб-сплэш (app/+html.tsx) прячет только главная. При заходе
    // сразу на вкладку его никто не снимает — снимаем сами, иначе на снимке
    // будет оранжевый экран загрузки вместо приложения.
    await page.evaluate(() => { try { window.__hideSplash && window.__hideSplash(); } catch {} });
    await page.waitForTimeout(1400);
    // Снимок + векторная версия. Вектор нужен, чтобы в Figma приехали
    // слои, а не картинка.
    const snap = async (id) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${id}.png`) });
      await page.addScriptTag({ path: path.resolve('scripts/dom-to-svg.js') });
      const svg = await page.evaluate(([w, h]) => window.__domToSvg({ width: w, height: h }), [VW, VH]);
      fs.writeFileSync(path.join(VEC, `${id}.svg`), svg);
      shotIds.push(id);
    };

    if (shot.walk) await shot.walk(page, snap);
    else await snap(shot.id);
    results.push({ id: shot.id, ok: true, errs: errs.slice(0, 2) });
  } catch (e) {
    results.push({ id: shot.id, ok: false, err: e.message.split('\n')[0] });
  }
  await ctx.close();
}

await browser.close();
srv.close();

fs.writeFileSync(path.join(VEC, 'index.json'), JSON.stringify(shotIds, null, 1));
console.log('снято экранов:', shotIds.length);
for (const r of results) {
  console.log(r.ok ? `✓ ${r.id}${r.errs?.length ? '  [' + r.errs.join(' | ') + ']' : ''}` : `✗ ${r.id}  ${r.err}`);
}
