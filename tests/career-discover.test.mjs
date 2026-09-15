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
import { findLists, guessMap, looksLikeVacancies } from '../scripts/career-discover-lib.mjs';

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
