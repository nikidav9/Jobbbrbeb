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
  dig,
  embeddedJson,
  hrefsWith,
  itemUrl,
  pickLinkPattern,
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
  // Хлебные крошки, карточка компании и меню выглядят так же. Требование
  // «минимум два элемента» отсекает эти ложные находки.
  assert.equal(looksLikeVacancies([{ name: 'О компании' }]), false);
  assert.equal(looksLikeVacancies([{ name: 'Раздел' }, { name: 'Другой' }]), true);
});

test('список строк и список чисел не принимаются за вакансии', () => {
  assert.equal(looksLikeVacancies(['Москва', 'Питер']), false);
  assert.equal(looksLikeVacancies([1, 2, 3]), false);
  assert.equal(looksLikeVacancies([]), false);
});

test('берёт самый длинный список, а не первый попавшийся', () => {
  // Фильтры и справочники в ответе идут раньше самих вакансий и тоже выглядят
  // как [{id, name}]. Выбор по длине защищает от подмены.
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

// Сам файл — тоже вход, и опечатка в нём тихо выкидывает компанию: строка на
// месте, а в отчёте её нет. Ловится именно это — пробел вместо табуляции,
// «htps://» вместо «https://» (обе мутации проверены, обе валят тест).
// Удаление целой строки тест НЕ ловит и ловить не должен: это правка списка
// владельцем, а не поломка разбора.
test('свой список компаний разбирается целиком', () => {
  const text = fs.readFileSync(new URL('../scripts/career-sites.tsv', import.meta.url), 'utf8');
  const rows = parseSiteList(text);
  const meaningful = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  assert.equal(rows.length, meaningful.length, 'какая-то строка списка не разобралась');
  assert.ok(rows.length >= 150, `компаний слишком мало: ${rows.length}`);
  assert.ok(rows.every(r => r.name && !r.name.includes('http')), 'имя компании потерялось');
  // Повтор — это ОДИН И ТОТ ЖЕ адрес. Разные разделы одного сайта повтором не
  // считаются: у Самоката корень и /vacancies-business — разные наборы
  // вакансий, и нужны оба. Поэтому хост проверять нельзя, а адрес — нужно.
  const urls = rows.map(r => r.url);
  assert.equal(new Set(urls).size, urls.length,
    `адрес повторяется: ${urls.filter((u, i) => urls.indexOf(u) !== i).join(', ')}`);
  // Название при этом должно оставаться различимым, иначе в отчёте две строки
  // «Самокат» и не понять, какая из какого раздела.
  const names = rows.map(r => r.name);
  assert.equal(new Set(names).size, names.length,
    `название повторяется: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

// Ниже — разбор провала: прогон по 111 компаниям дал семь «готовых» источников,
// и четыре из них оказались справочниками. Выбор шёл по ДЛИНЕ списка, а
// справочник всегда длиннее: у Ростелекома 655 городов против 382 вакансий.
// Образцы настоящие, снятые с тех самых ответов.

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

// У шести компаний в списке по два раздела. Проверяем, что это именно так
// задумано, а не расползлось само: раздел должен быть виден в названии.
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

// Тридцать сайтов из шестидесяти двух отдают вакансии только после нажатия
// кнопки. Слова на ней решают, куда разведка ткнёт, — проверяем их отдельно.
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

/**
 * Ссылки на вакансии прямо в разметке.
 *
 * Самый частый и самый простой случай, который разведка раньше не видела
 * вовсе: сайт отдаёт готовый HTML со ссылками, JSON-запроса нет, и в отчёте
 * стояло «нет данных». Найденный здесь `link_path` уходит в `mode: html_links`
 * — тот же разбор, что на проде делает cf_html_links.
 */
const ANCHORS_TYPICAL = [
  { href: 'https://job.x.ru/vacancy/101', text: 'Комплектовщик на склад' },
  { href: 'https://job.x.ru/vacancy/102', text: 'Упаковщик товара' },
  { href: 'https://job.x.ru/vacancy/103', text: 'Оператор call-центра' },
];

test('находит путь ссылки на вакансию среди якорей страницы', () => {
  const got = pickLinkPattern(ANCHORS_TYPICAL, 'https://job.x.ru/vacancies');
  assert.equal(got.link_path, '/vacancy/');
  assert.equal(got.tails, 3);
});

test('новости не выигрывают у вакансий, даже когда их больше', () => {
  // Без веса на «вакансионное» слово в пути побеждал бы раздел с бо́льшим
  // числом разных хвостов — то есть разведка уверенно предложила бы читать
  // новости. Поэтому новостей здесь намеренно БОЛЬШЕ.
  const anchors = [
    ...ANCHORS_TYPICAL,
    { href: 'https://job.x.ru/news/a-very-long-news-title', text: 'Мы открыли новый склад' },
    { href: 'https://job.x.ru/news/b-another-long-title', text: 'Итоги полугодия компании' },
    { href: 'https://job.x.ru/news/c-third-long-title', text: 'Как мы нанимаем людей' },
    { href: 'https://job.x.ru/news/d-fourth-long-title', text: 'Новый офис в Казани' },
  ];
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies').link_path, '/vacancy/');
});

test('ссылка на сам раздел не считается вакансией', () => {
  // «Все вакансии» ведёт на /vacancy без хвоста: хвоста нет — и группы нет.
  // Плюс текст раздела не даёт признака «с должностью».
  const anchors = [
    { href: 'https://job.x.ru/vacancy', text: 'Все вакансии' },
    { href: 'https://job.x.ru/vacancy/', text: 'Вакансии в Москве' },
  ];
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies'), null);
});

test('без единого человеческого заголовка шаблон не принимается', () => {
  // Ссылки с картинок: href есть, текста нет. cf_html_links на проде отбросит
  // такие по min_title и вернёт пусто — значит и разведке принимать нечего.
  const anchors = ANCHORS_TYPICAL.map(a => ({ href: a.href, text: '' }));
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies'), null);
});

test('чужой домен в ссылках не попадает в шаблон', () => {
  // Кнопка «откликнуться на hh» есть почти на каждой карьерной странице.
  // Взять её путь значит завести источник, ведущий на агрегатор, — прямо
  // против решения владельца.
  const anchors = [
    { href: 'https://hh.ru/vacancy/901', text: 'Откликнуться на hh.ru' },
    { href: 'https://hh.ru/vacancy/902', text: 'Смотреть на hh.ru подробно' },
    { href: 'https://hh.ru/vacancy/903', text: 'Ещё одна вакансия на hh.ru' },
  ];
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies'), null);
});

test('двух разных вакансий мало: нужен порог', () => {
  // Две ссылки даёт любая пара «о компании / контакты» внутри одного раздела.
  const anchors = ANCHORS_TYPICAL.slice(0, 2);
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies'), null);
});

test('путь берётся целиком, а не по первому сегменту', () => {
  // У части сайтов вакансии лежат глубже: /career/vacancies/<id>. Если
  // отрезать по первому сегменту, в конфиг уйдёт /career/ — а под ним же
  // лежат «о нас» и «льготы», и лента наберёт разделов вместо вакансий.
  const anchors = [
    { href: 'https://job.x.ru/career/vacancies/101', text: 'Комплектовщик на склад' },
    { href: 'https://job.x.ru/career/vacancies/102', text: 'Упаковщик товара' },
    { href: 'https://job.x.ru/career/vacancies/103', text: 'Оператор call-центра' },
    { href: 'https://job.x.ru/career/about', text: 'О компании и наших людях' },
  ];
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies').link_path, '/career/vacancies/');
});

test('относительные ссылки разбираются от адреса страницы', () => {
  const anchors = [
    { href: '/vacancy/101', text: 'Комплектовщик на склад' },
    { href: '/vacancy/102', text: 'Упаковщик товара' },
    { href: '/vacancy/103', text: 'Оператор call-центра' },
  ];
  assert.equal(pickLinkPattern(anchors, 'https://job.x.ru/vacancies').link_path, '/vacancy/');
});

test('строгий режим не принимает путь без слова о вакансиях', () => {
  // На живом прогоне Koronatech предложил `/about/`: вакансий на странице нет,
  // и победило единственное, у чего набралось три разных хвоста. Такой путь
  // уходит прямо в production-источник, поэтому «лучший из имеющихся» здесь
  // не годится.
  const anchors = [
    { href: 'https://x.ru/about/history', text: 'История компании с 1998 года' },
    { href: 'https://x.ru/about/team', text: 'Наша команда и ценности' },
    { href: 'https://x.ru/about/offices', text: 'Офисы и представительства' },
  ];
  assert.ok(pickLinkPattern(anchors, 'https://x.ru/career'), 'в обычном режиме находка есть');
  assert.equal(pickLinkPattern(anchors, 'https://x.ru/career', 3, true), null);
});

test('строгий режим пропускает настоящий путь вакансий', () => {
  assert.equal(
    pickLinkPattern(ANCHORS_TYPICAL, 'https://job.x.ru/vacancies', 3, true).link_path,
    '/vacancy/',
  );
});

/**
 * Сборка ссылки на вакансию — то же правило, что у cf_json_url на проде.
 * Здесь проверка, что проверялка не соврёт: она решает, включать источник или
 * нет, и ошибка в ней пропустит в ленту вакансию с битой ссылкой.
 */
test('слаг из двух сегментов не превращается в %2F', () => {
  // Слаг Lamoda — `moskva/analitik--3020`. Сплошное кодирование ломает адрес,
  // и вакансия открывается в никуда. На проде это уже ловили.
  assert.equal(
    itemUrl({ slug: 'moskva/analitik--3020' },
      { url_template: 'https://job.lamoda.ru/vacancies/{slug}' }, 'https://job.lamoda.ru'),
    'https://job.lamoda.ru/vacancies/moskva/analitik--3020',
  );
});

test('опасные знаки в значении всё-таки экранируются', () => {
  // Кодирование посегментно не должно открывать подстановку чужого адреса.
  const got = itemUrl({ id: 'x?a=1#b' }, { url_template: 'https://x.ru/v/{id}' }, 'https://x.ru');
  assert.equal(got, 'https://x.ru/v/x%3Fa%3D1%23b');
});

test('готовая ссылка из ответа важнее шаблона', () => {
  assert.equal(
    itemUrl({ link: '/vacancy/7', id: 99 },
      { url: 'link', url_template: 'https://x.ru/job/{id}' }, 'https://x.ru'),
    'https://x.ru/vacancy/7',
  );
});

test('путь до списка разбирается и через массив', () => {
  assert.deepEqual(dig({ data: { items: [1, 2] } }, 'data.items'), [1, 2]);
  assert.equal(dig({ a: [{ b: 5 }] }, 'a[].b'), 5);
  // Нет такого пути — null, а не исключение: коннектор дальше просто не
  // возьмёт этот источник, а падение уронило бы весь обход.
  assert.equal(dig({ a: 1 }, 'нет.такого'), null);
});

/**
 * Ссылки из СЫРОГО HTML и встроенные в страницу данные.
 *
 * Это то, чем проверялка решает, включать источник или нет. Первая её версия
 * собирала адрес сама — origin + кусок пути + хвост — и обрезала хвост по
 * первому «/». Контур, IBS и Техвилл получали 404 при том, что на проде эти
 * три источника работают и дают 62, 45 и 20 вакансий.
 */
test('берётся настоящий href, а не собранный адрес', () => {
  const html = '<a href="/career/vacancies/moskva/ops--12">Оператор склада</a>';
  assert.deepEqual(
    hrefsWith(html, '/career/vacancies/', 'https://kontur.ru/career/vacancies'),
    ['https://kontur.ru/career/vacancies/moskva/ops--12'],
  );
});

test('ссылка на сам раздел в выборку не попадает', () => {
  const html = '<a href="/vacancies/">Все вакансии</a><a href="/vacancies/?city=msk">В Москве</a>';
  assert.deepEqual(hrefsWith(html, '/vacancies/', 'https://x.ru/vacancies'), []);
});

test('одна вакансия двумя ссылками считается один раз', () => {
  // С картинки и с заголовка — обычное дело, счёт по вхождениям завысил бы
  // находку вдвое.
  const html = '<a href="/vacancy/7"><img></a><a href="/vacancy/7">Комплектовщик</a>';
  assert.equal(hrefsWith(html, '/vacancy/', 'https://x.ru/jobs').length, 1);
});

test('встроенные данные достаются и из Next, и из Nuxt', () => {
  assert.equal(
    embeddedJson('<script id="__NEXT_DATA__" type="application/json">{"a":1}</script>'),
    '{"a":1}',
  );
  assert.equal(embeddedJson('<script>window.__NUXT__ = {"b":2};</script>'), '{"b":2}');
  assert.equal(embeddedJson('<html><body>ничего</body></html>'), '');
});
