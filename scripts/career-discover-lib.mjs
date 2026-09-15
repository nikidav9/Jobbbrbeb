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
