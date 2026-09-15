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
    out.push({ path, count: node.length, sample: node[0] });
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
