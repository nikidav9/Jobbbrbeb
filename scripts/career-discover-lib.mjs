/**
 * Разбор ответов карьерных сайтов: чистые функции без сети и браузера.
 *
 * Отделены от scripts/career-discover.mjs по тому же правилу, по которому в
 * php-proxy разбор живёт в career_feed.php, а сеть в career.php: решение «что
 * здесь список вакансий и какое поле за что отвечает» должно проверяться на
 * выдуманных данных. На живом сайте такое не проверишь — он меняется, а
 * ошибиться тут значит завести источник, который молча принесёт мусор.
 */

/** Имена, под которыми в чужих ответах лежит одно и то же. Порядок — приоритет. */
export const FIELD_HINTS = {
  title: ['title', 'name', 'position', 'vacancyName', 'jobTitle', 'header'],
  id: ['id', 'slug', 'code', 'externalId', 'vacancyId'],
  url: ['url', 'link', 'href', 'permalink', 'webUrl'],
  address: ['city', 'town', 'location', 'address', 'region', 'office'],
  pay: ['salary', 'money', 'salaryFrom', 'salary_from', 'compensation', 'pay'],
  description: ['description', 'shortDescription', 'intro', 'summary', 'annotation'],
  schedule: ['employment', 'empl', 'workFormat', 'work_format', 'schedule', 'employmentType'],
  company: ['company', 'employer', 'organization', 'direction', 'department'],
  closed: ['archived_at', 'archivedAt', 'isArchived', 'closed', 'isClosed', 'inactive'],
};

/**
 * Признаки, которые есть у вакансии и которых нет у справочника.
 *
 * Добыто разбором прогона по 111 компаниям. Четыре «готовых» источника из семи
 * оказались не вакансиями: у Ростелекома выбрался справочник из 655 городов, у
 * МТС — дерево категорий, у Золотого Яблока — меню шапки, у Wildberries —
 * список направлений. Все они выглядят как `[{id, name}]` и все длиннее
 * настоящего списка вакансий, а выбор шёл по длине.
 *
 * Название сюда НЕ входит: оно есть и у города, и у категории. Считаем только
 * то, что у справочника взяться неоткуда, — деньги, место, текст обязанностей,
 * график, работодателя.
 */
export const VACANCY_EVIDENCE = {
  pay: ['salary', 'salaryFrom', 'salaryTo', 'salary_from', 'salary_min', 'salary_max', 'money',
    'compensation', 'pay', 'wage'],
  address: ['city', 'cities', 'town', 'location', 'address', 'region', 'office', 'workPlace'],
  text: ['description', 'shortDescription', 'intro', 'annotation', 'requirements', 'duties',
    'conditions', 'tasks', 'responsibilities', 'content', 'shortInfo', 'whatWeToDo'],
  schedule: ['employment', 'empl', 'workFormat', 'work_format', 'schedule', 'workSchedule',
    'employmentType', 'employment_types', 'experience', 'experienceId', 'experience_type_title'],
  company: ['company', 'employer', 'organization', 'direction', 'directions', 'department',
    'team', 'division'],
  published: ['publicationDate', 'publishedAt', 'published_at', 'createdAt', 'created_at',
    'updatedAt', 'updated_at', 'externalPublicationDate'],
};

/**
 * Сколько признаков вакансии в образце. Ноль-один — почти наверняка справочник.
 *
 * Считаем ГРУППЫ, а не поля: три названия зарплаты в одной записи — это всё
 * ещё один довод, а зарплата вместе с городом и графиком — три разных.
 */
export function scoreList(sample) {
  if (!sample || typeof sample !== 'object') return 0;
  // Сравниваем по НАЧАЛУ имени, приведя обе стороны к буквам: одно и то же поле
  // зовут `city`, `city_title` и `cityName`. Перечислять все хвосты бесполезно —
  // на Wildberries это `city_title` и `direction_role_title`, на следующем сайте
  // будет свой. Начало имени задаёт смысл, хвост — только огранку.
  const flat = k => String(k).toLowerCase().replace(/[^a-zа-я]/gi, '');
  const keys = Object.keys(sample).map(flat);
  let score = 0;
  for (const group of Object.values(VACANCY_EVIDENCE)) {
    if (group.some(h => keys.some(k => k.startsWith(flat(h))))) score += 1;
  }
  return score;
}

/**
 * Похож ли массив на список вакансий.
 *
 * Требуем минимум два элемента: одиночный объект с полем name встречается в
 * ответах повсеместно — это и хлебные крошки, и карточка компании, и что
 * угодно ещё. Список из одного такого дал бы ложную находку.
 */
export function looksLikeVacancies(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const first = value[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return false;
  const keys = Object.keys(first);
  return FIELD_HINTS.title.some(h => keys.includes(h));
}

/**
 * Все списки вакансий в ответе, с путём до каждого.
 *
 * Глубина ограничена: ответ присылает чужой сервер, и уходить по нему в
 * рекурсию нельзя. У массивов смотрим только первые элементы — вложенный
 * список вакансий встречается, а перебирать тысячу однотипных строк незачем.
 */
export function findLists(node, path = '', depth = 0, out = []) {
  if (depth > 8 || out.length >= 12) return out;
  if (looksLikeVacancies(node)) {
    out.push({ path, count: node.length, sample: node[0], score: scoreList(node[0]) });
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 3)) findLists(item, path ? `${path}[]` : '[]', depth + 1, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      findLists(value, path ? `${path}.${key}` : key, depth + 1, out);
    }
  }
  return out;
}

/** Догадка о соответствии полей: наше имя → имя в образце. */
export function guessMap(sample) {
  const keys = Object.keys(sample);
  const map = {};
  for (const [ours, hints] of Object.entries(FIELD_HINTS)) {
    const hit = hints.find(h => keys.includes(h));
    if (hit) map[ours] = hit;
  }
  return map;
}

/** Варианты адреса вакансии, которые стоит проверить, если ссылки в ответе нет. */
export const URL_SHAPES = ['/vacancy/{v}', '/vacancies/{v}', '/job/{v}', '/jobs/{v}', '/v/{v}'];

/**
 * Разбор списка сайтов: `Название<TAB>адрес`, `#` — комментарий.
 *
 * Название берём из файла, а не из имени хоста: в отчёте «Пятёрочка» читается,
 * а `rabota5ka.ru` — нет, и сверять результат разведки со списком владельца
 * придётся глазами. Строка без табуляции — просто адрес, имя тогда хостовое.
 */
export function parseSiteList(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    const name = tab > 0 ? line.slice(0, tab).trim() : '';
    const url = (tab > 0 ? line.slice(tab + 1) : line).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    out.push({ name: name || host, url });
  }
  return out;
}

/** Параметры, которые НЕ сужают выдачу: разбивка на страницы и язык. */
const HARMLESS_PARAMS = /^(limit|offset|page|per_?page|take|skip|size|count|start|pagination|lang|language|locale|sort|order)$/i;

/**
 * Не сужен ли найденный адрес фильтром.
 *
 * Разведка приходит на конкретный раздел сайта, и сайт зовёт своё API уже с
 * фильтром этого раздела. Записать такой адрес в настройку значит навсегда
 * забрать только кусок: у X5 это `?business_units=10`, то есть одно
 * подразделение из всех. Нам нужны ВСЕ виды вакансий, поэтому такой адрес надо
 * показать человеку, а не молча принять.
 *
 * Пустое значение не в счёт: `search=&minExperience=` у Lamoda — это незаполненные
 * поля формы, они ничего не сужают.
 */
export function endpointWarning(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const narrowing = [];
  for (const [key, value] of params) {
    if (!value) continue;
    // Имена вида `pagination[limit]` смотрим и целиком, и по внутренней части:
    // разбивку на страницы так пишет Strapi и всё, что на нём, — у Lamoda
    // именно так. А вот `filter[city]` внутренней частью и выдаст себя.
    const inner = key.replace(/^.*\[|\]$/g, '') || key;
    if (HARMLESS_PARAMS.test(key) || HARMLESS_PARAMS.test(inner)) continue;
    narrowing.push(`${key}=${value}`);
  }
  if (!narrowing.length) return null;
  return `адрес сужен фильтром (${narrowing.join(', ')}) — возможно, это только часть вакансий`;
}

/**
 * Обещает ли надпись на кнопке список вакансий.
 *
 * Замер по списку владельца: тридцать сайтов из шестидесяти двух отдают
 * вакансии только после нажатия «Показать вакансии», «Все вакансии» или
 * выбора города. Открытая и прокрученная страница у них пуста, сколько ни
 * жди, — это и была главная причина «нет данных».
 *
 * Длину ограничиваем: длинный текст — это абзац, а не кнопка, и нажимать на
 * него незачем.
 */
const CLICK_WORDS = /ваканс|показать|все предложения|найти работу|смотреть|подобрать|все направления/i;

export function looksClickable(text) {
  const t = String(text ?? '').trim();
  if (t.length < 3 || t.length > 40) return false;
  return CLICK_WORDS.test(t);
}

/**
 * Что из браузерного запроса можно безопасно повторить обычным curl.
 *
 * Раньше разведка сохраняла только URL ответа. Для POST/GraphQL это превращало
 * рабочий браузерный запрос в GET без тела — прод закономерно получал 404/405
 * или пустой список. Тело сохраняем только если это небольшой JSON без ключей,
 * похожих на секреты. Cookies/Authorization намеренно не переносим: такой
 * источник требует отдельного согласованного адаптера, а не копирования сессии.
 */
const SENSITIVE_REQUEST_KEY = /(^|[_-])(auth|authorization|token|secret|password|passwd|cookie|session|csrf|api[_-]?key|access[_-]?key)($|[_-])/i;

function hasSensitiveRequestKey(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(v => hasSensitiveRequestKey(v, depth + 1));
  return Object.entries(value).some(([key, child]) =>
    SENSITIVE_REQUEST_KEY.test(key) || hasSensitiveRequestKey(child, depth + 1));
}

export function replayRequestConfig(method, postData) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET') return { ok: true, config: {} };
  if (verb !== 'POST') return { ok: false, reason: `метод ${verb} требует отдельного адаптера` };
  if (typeof postData !== 'string' || postData.trim() === '') {
    return { ok: false, reason: 'POST без JSON-тела требует отдельного адаптера' };
  }
  if (Buffer.byteLength(postData, 'utf8') > 32 * 1024) {
    return { ok: false, reason: 'POST-тело больше 32 КБ — не сохраняем автоматически' };
  }

  let body;
  try { body = JSON.parse(postData); } catch {
    return { ok: false, reason: 'POST-тело не JSON — нужен отдельный адаптер' };
  }
  if (body === null || typeof body !== 'object') {
    return { ok: false, reason: 'POST JSON не объект/массив — нужен отдельный адаптер' };
  }
  if (hasSensitiveRequestKey(body)) {
    return { ok: false, reason: 'POST-тело похоже на секрет/сессию — автоматически не сохраняем' };
  }
  return { ok: true, config: { method: 'POST', body } };
}

/**
 * Слова, по которым путь опознаётся как «вакансия», а не раздел сайта.
 *
 * Латиница и транслит вперемешку намеренно: у российских работодателей путь
 * бывает и `/vacancy/`, и `/rabota/`, и `/karera/`.
 */
const VACANCY_PATH_WORD = /vacan|vakans|job|career|karier|karer|rabota|position|opening/i;

/**
 * Ссылки-пустышки, которые есть на любой карьерной странице.
 *
 * Отсекаем по НАЧАЛУ текста: «Все вакансии», «Вакансии в Москве» — это
 * разделы, а не должности, и попадание такой ссылки в ленту выглядит как
 * поломка. Замерено на живых страницах — cf_html_links на проде режет их же.
 */
const LINK_SECTION_TEXT = /^(все|всего|показать|смотреть|перейти|подробн|ещё|еще|вакансии|каталог|назад)/i;

/**
 * Найти шаблон ссылки на вакансию среди якорей страницы.
 *
 * Зачем отдельно от findLists. Разведка искала вакансии только в JSON, и когда
 * сайт отдаёт готовый HTML — самый частый и самый простой случай — она писала
 * «нет данных». Конкурент при этом такие сайты читает. Здесь мы повторяем то,
 * что на проде уже умеет cf_html_links: найти в разметке кусок пути, общий для
 * ссылок на отдельные вакансии.
 *
 * Возвращает `{link_path, tails, titled}` или null. `link_path` — ровно то,
 * что ложится в `map.link_path` конфигурации `mode: html_links`.
 *
 * @param {Array<{href: string, text: string}>} anchors якоря отрендеренной страницы
 * @param {string} pageUrl адрес самой карьерной страницы
 */
export function pickLinkPattern(anchors, pageUrl, minTails = 3, requireVacancyWord = false) {
  let host;
  try { host = new URL(pageUrl).hostname; } catch { return null; }
  const groups = new Map();
  for (const a of anchors || []) {
    let u;
    try { u = new URL(a.href, pageUrl); } catch { continue; }
    if (u.hostname !== host) continue;
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const text = String(a.text || '').trim();
    // Считаем ссылку «с должностью», только если текст похож на название
    // вакансии: не раздел и достаточно длинный. Пустой текст бывает у ссылки
    // с картинки — она дублирует заголовочную и роли не играет.
    const titled = text.length >= 8 && !LINK_SECTION_TEXT.test(text);
    for (let i = 1; i < segments.length; i += 1) {
      const prefix = `/${segments.slice(0, i).join('/')}/`;
      const tail = segments.slice(i).join('/');
      if (!tail) continue;
      let g = groups.get(prefix);
      if (!g) { g = { tails: new Set(), leaves: new Set(), titled: 0 }; groups.set(prefix, g); }
      g.tails.add(tail);
      if (!tail.includes('/')) g.leaves.add(tail);
      if (titled) g.titled += 1;
    }
  }

  let best = null;
  for (const [prefix, g] of groups) {
    const tails = g.tails.size;
    if (tails < minTails) continue;
    // Путь со словом «вакансия» весит больше любого другого: на карьерном
    // сайте `/news/` тоже даст десяток разных хвостов, и без этого правила
    // разведка уверенно предложила бы читать новости.
    //
    // Дальше решает ЧИСТОТА, а не длина списка. Считать по числу хвостов
    // нельзя: у `/career/vacancies/` их ровно столько, сколько вакансий, а у
    // более короткого `/career/` — те же вакансии ПЛЮС «о нас» и «льготы»,
    // то есть всегда больше. Побеждал бы короткий путь, и в ленту шли бы
    // разделы сайта.
    const purity = g.titled / tails;
    // И «листовость»: у ссылки на вакансию хвост — один сегмент (`101`), а не
    // `vacancies/101`. Без этого побеждает более КОРОТКИЙ путь: под `/career/`
    // лежат те же вакансии плюс «о нас», то есть хвостов у него всегда больше,
    // а текст «О компании и наших людях» ничем не хуже названия должности.
    const leaves = g.leaves.size / tails;
    const score = (VACANCY_PATH_WORD.test(prefix) ? 10000 : 0)
      + purity * 1000 + leaves * 500 + Math.min(tails, 50);
    if (!best || score > best.score) best = { link_path: prefix, tails, titled: g.titled, score };
  }
  if (!best) return null;
  // Без единой ссылки с человеческим заголовком это не список вакансий:
  // cf_html_links на проде отбросит такие ссылки по min_title и вернёт пусто.
  if (best.titled === 0) return null;
  // Когда находка пойдёт в production-источник, «лучший из имеющихся» путь не
  // годится: на сайте без вакансий побеждает что угодно с тремя разными
  // хвостами. Замерено на живом прогоне — Koronatech предложил `/about/`.
  // В ленту это принесло бы разделы сайта вместо должностей.
  if (requireVacancyWord && !VACANCY_PATH_WORD.test(best.link_path)) return null;
  return { link_path: best.link_path, tails: best.tails, titled: best.titled };
}

/** Значение по пути вида `data.items` или `items[].vacancies`. */
export function dig(node, path) {
  if (!path) return node;
  let cur = node;
  for (const step of path.split('.')) {
    if (cur == null) return null;
    if (step.endsWith('[]')) {
      const key = step.slice(0, -2);
      cur = key ? cur[key] : cur;
      if (!Array.isArray(cur)) return null;
      cur = cur[0];
    } else {
      cur = cur[step];
    }
  }
  return cur;
}

/** Ссылка на вакансию из записи: прямая, относительная или по шаблону. */
export function itemUrl(item, map, origin) {
  const direct = map.url ? item[map.url] : '';
  if (typeof direct === 'string' && direct) {
    try { return new URL(direct, origin).href; } catch { /* не адрес */ }
  }
  const template = map.url_template || '';
  if (!template) return '';
  // Каждый сегмент пути кодируется отдельно — ровно как cf_json_url на проде.
  // Сплошной encodeURIComponent превращает «/» в «%2F», и слаг Lamoda
  // `moskva/analitik--3020` ломается: он состоит из двух сегментов. «?», «#»
  // и «:» при этом всё равно экранируются, чужой адрес не подставить.
  return template.replace(/\{(\w+)\}/g, (_, field) => String(item[field] ?? '')
    .split('/')
    .map(encodeURIComponent)
    .join('/'));
}
