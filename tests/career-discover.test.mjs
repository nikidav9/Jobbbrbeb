/**
 * Разбор ответов карьерных сайтов в разведке.
 *
 * Проверяется то, что решает исход разведки: где в чужом ответе список вакансий
 * и какое поле за что отвечает. Ошибка здесь не падает с исключением — она
 * молча заводит источник, который принесёт мусор или не принесёт ничего.
 *
 * Все образцы взяты с живых ответов: careers.yadro.com, team.vk.company,
 * opportunities.huntflow.io, job.2gis.ru.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  endpointWarning,
  findLists,
  guessMap,
  looksClickable,
  looksLikeVacancies,
  parseSiteList,
  replayRequestConfig,
  scoreList,
} from '../scripts/career-discover-lib.mjs';

test('находит список вакансий в ответе Yadro', () => {
  const body = { vacancies: [
    { id: 2511, slug: '102511', title: 'SRE-инженер', city: [{ id: 2, name: 'Москва' }] },
    { id: 2510, slug: '102510', title: 'Инженер по ИБ', city: [{ id: 2, name: 'Москва' }] },
  ], utm_params: {} };
  const [found] = findLists(body);
  assert.equal(found.path, 'vacancies');
  assert.equal(found.count, 2);
});

test('находит список, вложенный глубоко, — формат VK', () => {
  // У VK вакансии лежат в props.pageProps.initialVacancies внутри __NEXT_DATA__.
  const body = { props: { pageProps: { initialVacancies: [
    { id: 1, title: 'Backend-разработчик', town: 'Москва', remote: false },
    { id: 2, title: 'Аналитик', town: 'Санкт-Петербург', remote: true },
  ], initialTotalCount: 62 } } };
  const [found] = findLists(body);
  assert.equal(found.path, 'props.pageProps.initialVacancies');
  assert.equal(found.count, 2);
});

test('угадывает поля формата Хантфлоу', () => {
  const map = guessMap({ id: 20009, slug: 'go-3', position: 'Golang Dev',
    money: null, division: 'Техи', city: 'Москва', archived_at: null });
  assert.equal(map.title, 'position');
  assert.equal(map.id, 'id');
  assert.equal(map.address, 'city');
  assert.equal(map.pay, 'money');
  assert.equal(map.closed, 'archived_at');
});

test('угадывает поля формата 2ГИС', () => {
  const map = guessMap({ id: 525, title: 'Senior Kubernetes Engineer',
    shortDescription: 'Развивать платформу', isRemote: true, city: null,
    salaryFrom: null, salaryTo: null });
  assert.equal(map.title, 'title');
  assert.equal(map.description, 'shortDescription');
});

test('одиночный объект с полем name — не список вакансий', () => {
  assert.equal(looksLikeVacancies([{ name: 'О компании' }]), false);
  assert.equal(looksLikeVacancies([{ name: 'Раздел' }, { name: 'Другой' }]), true);
});

test('список строк и список чисел не принимаются за вакансии', () => {
  assert.equal(looksLikeVacancies(['Москва', 'Питер']), false);
  assert.equal(looksLikeVacancies([1, 2, 3]), false);
  assert.equal(looksLikeVacancies([]), false);
});

test('берёт самый длинный список, а не первый попавшийся', () => {
  const body = {
    filters: { towns: [{ id: 1, name: 'Москва' }, { id: 2, name: 'СПб' }] },
    items: Array.from({ length: 25 }, (_, i) => ({ id: i, title: `Вакансия ${i}` })),
  };
  const found = findLists(body);
  const best = found.reduce((a, b) => (b.count > a.count ? b : a));
  assert.equal(best.path, 'items');
  assert.equal(best.count, 25);
});

test('не уходит в бесконечную вложенность', () => {
  let deep = { title: 'дно' };
  for (let i = 0; i < 40; i++) deep = { next: deep };
  assert.doesNotThrow(() => findLists(deep));
});

test('пустая карта, если полей не узнали', () => {
  assert.deepEqual(guessMap({ foo: 1, bar: 2 }), {});
});

test('список сайтов: имя из файла, а не из хоста', () => {
  const rows = parseSiteList('Пятёрочка\thttps://rabota5ka.ru/vacancies');
  assert.deepEqual(rows, [{ name: 'Пятёрочка', url: 'https://rabota5ka.ru/vacancies' }]);
});

test('список сайтов: строка без имени берёт имя хоста', () => {
  assert.deepEqual(parseSiteList('https://job.hoff.ru/'),
    [{ name: 'job.hoff.ru', url: 'https://job.hoff.ru/' }]);
});

test('список сайтов: комментарии, пустые строки и мусор отброшены', () => {
  const rows = parseSiteList([
    '# заголовок',
    '',
    '   ',
    'Без адреса\tпросто текст',
    'Битый\thttp://',
    'Магнит\thttps://rabota.magnit.ru/',
  ].join('\n'));
  assert.deepEqual(rows, [{ name: 'Магнит', url: 'https://rabota.magnit.ru/' }]);
});

test('список сайтов: кириллический домен не роняет разбор', () => {
  const rows = parseSiteList('Ярче!\thttps://работаярче.рф/');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ярче!');
});

test('свой список компаний разбирается целиком', () => {
  const text = fs.readFileSync(new URL('../scripts/career-sites.tsv', import.meta.url), 'utf8');
  const rows = parseSiteList(text);
  const meaningful = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  assert.equal(rows.length, meaningful.length, 'какая-то строка списка не разобралась');
  assert.ok(rows.length >= 150, `компаний слишком мало: ${rows.length}`);
  assert.ok(rows.every(r => r.name && !r.name.includes('http')), 'имя компании потерялось');
  const urls = rows.map(r => r.url);
  assert.equal(new Set(urls).size, urls.length,
    `адрес повторяется: ${urls.filter((u, i) => urls.indexOf(u) !== i).join(', ')}`);
  const names = rows.map(r => r.name);
  assert.equal(new Set(names).size, names.length,
    `название повторяется: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

test('справочник городов Ростелекома не набирает признаков вакансии', () => {
  assert.equal(scoreList({ id: 2, name: 'г. Самара' }), 0);
});

test('дерево категорий МТС не набирает признаков вакансии', () => {
  assert.ok(scoreList({ id: 'w8n0', slug: 'hr-6037', title: 'HR', vacancyCount: 12 }) < 2);
});

test('направления Wildberries не набирают признаков вакансии', () => {
  assert.ok(scoreList({ description: '', id: 2, title: 'Аналитика', vacancies_count: 17 }) < 2);
});

test('настоящая вакансия Ростелекома набирает признаки', () => {
  const vac = {
    id: 14488, name: 'Бригадир монтажников', address: 'ул. Советская, д. 136',
    salaryFrom: 94750, salaryTo: 94750, city: { id: 159, name: 'г. Йошкар-Ола' },
    directions: [{ id: 4, name: 'Технический блок' }], whatWeToDo: '<p>Определение порядка</p>',
  };
  assert.ok(scoreList(vac) >= 4, `признаков мало: ${scoreList(vac)}`);
});

test('настоящая вакансия Wildberries набирает признаки', () => {
  const vac = {
    id: 34863, city_title: 'Московская область, дер. Коледино', direction_role_title: 'Повар',
    direction_title: 'Производство питания', experience_type_title: 'От 1 года',
    employment_types: [{ id: 3, title: 'Офис' }],
  };
  assert.ok(scoreList(vac) >= 2, `признаков мало: ${scoreList(vac)}`);
});

test('вакансии выигрывают у справочника, даже будучи короче', () => {
  const body = {
    cities: Array.from({ length: 655 }, (_, i) => ({ id: i, name: `город ${i}` })),
    vacancies: Array.from({ length: 20 }, (_, i) => ({
      id: i, name: 'Комплектовщик', city: 'Москва', salaryFrom: 60000, description: 'смены',
    })),
  };
  const found = findLists(body);
  const best = [...found].sort((a, b) => b.score - a.score || b.count - a.count)[0];
  assert.equal(best.path, 'vacancies', `выбран не тот список: ${best.path}`);
  assert.ok(best.score > found.find(f => f.path === 'cities').score);
});

test('сужающий фильтр в адресе замечен', () => {
  const note = endpointWarning('https://prod-lkk-back.x5.ru/api/v1/public/vacancies/filters/?business_units=10');
  assert.ok(note && note.includes('business_units=10'), `не заметили фильтр: ${note}`);
});

test('разбивка на страницы и язык фильтром не считаются', () => {
  assert.equal(endpointWarning('https://careers.yadro.com/api/v1/vacancies/?limit=15'), null);
  assert.equal(endpointWarning('https://vacancies-app.aviasales.ru/api/vacancies?language=ru'), null);
});

test('пустые поля формы фильтром не считаются', () => {
  assert.equal(
    endpointWarning('https://job.lamoda.ru/api/hr/vacancies/compact?search=&minExperience=&pagination[limit]=10'),
    null);
});

test('адрес без параметров и мусор не роняют проверку', () => {
  assert.equal(endpointWarning('https://job.rt.ru/backend/api/vacancies'), null);
  assert.equal(endpointWarning('(в HTML страницы)'), null);
});

test('у компании с несколькими разделами раздел виден в названии', () => {
  const rows = parseSiteList(fs.readFileSync(new URL('../scripts/career-sites.tsv', import.meta.url), 'utf8'));
  const byHost = new Map();
  for (const r of rows) {
    const h = new URL(r.url).hostname;
    byHost.set(h, [...(byHost.get(h) || []), r]);
  }
  const multi = [...byHost.values()].filter(v => v.length > 1);
  assert.ok(multi.length >= 1, 'разделов ни у кого нет — склейка съела их');
  for (const group of multi) {
    for (const r of group) {
      assert.ok(r.name.includes(' · '), `раздел не помечен в названии: ${r.name}`);
    }
  }
});

test('надписи, обещающие список вакансий, узнаются', () => {
  for (const t of ['Показать вакансии', 'Все вакансии', 'Смотреть вакансии',
                   'Подобрать вакансию', 'Найти работу', 'ВАКАНСИИ']) {
    assert.ok(looksClickable(t), `не узнали: ${t}`);
  }
});

test('обычные кнопки не трогаем', () => {
  for (const t of ['Отправить резюме', 'Войти', 'Принять cookies', 'Наверх', '']) {
    assert.equal(looksClickable(t), false, `зря нажали бы: ${t}`);
  }
});

test('длинный текст — это абзац, а не кнопка', () => {
  assert.equal(looksClickable('Здесь вы найдёте вакансии нашей компании по всей стране и сможете откликнуться'), false);
});

// Cofinder держит отдельные парсеры, и часть карьерных сайтов грузит вакансии
// POST/GraphQL. Разведка должна сохранить способ запроса, а не превратить его в GET.
test('GET можно повторить без дополнительных настроек', () => {
  assert.deepEqual(replayRequestConfig('GET', null), { ok: true, config: {} });
});

test('POST JSON сохраняет метод и тело', () => {
  assert.deepEqual(
    replayRequestConfig('POST', '{"page":1,"filters":{"city":[]}}'),
    { ok: true, config: { method: 'POST', body: { page: 1, filters: { city: [] } } } },
  );
});

test('секреты из браузерной сессии в connector_config не попадают', () => {
  const result = replayRequestConfig('POST', '{"variables":{"access_token":"secret"}}');
  assert.equal(result.ok, false);
  assert.match(result.reason, /секрет|сесси/i);
});

test('форму и неподдерживаемый метод не выдаём за готовый источник', () => {
  assert.equal(replayRequestConfig('POST', 'city=Moscow&page=1').ok, false);
  assert.equal(replayRequestConfig('PUT', '{"page":1}').ok, false);
});

test('разведчик сохраняет request metadata и настоящий embedded endpoint', () => {
  const discover = fs.readFileSync(new URL('../scripts/career-discover.mjs', import.meta.url), 'utf8');
  assert.match(discover, /method:\s*request\.method\(\)/);
  assert.match(discover, /postData:\s*request\.postData\(\)/);
  assert.match(discover, /replayRequestConfig\(cap\.method, cap\.postData\)/);
  assert.match(discover, /config:\s*\{\s*mode:\s*'embedded'\s*\}/);
  assert.doesNotMatch(discover, /consider\(found, '\(в HTML страницы\)'/);
});
