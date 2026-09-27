// Фильтры полосы чипов над колодой (services/feedFilters.ts). Клиент фильтрует
// только свои вакансии JobToo — карьерные фильтрует сервер (php-proxy/ext_feed.php),
// у него свой тест (tests/ext_feed_test.php).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FEED_FILTERS, isFilterActive, activeCount, matchOwnVacancy, toExtFeedFilters, pluralVacancies,
} from '../services/feedFilters.ts';

const NOW = Date.parse('2026-09-27T12:00:00Z');

const base = {
  title: 'Senior Java-разработчик',
  company: 'Контур',
  schedule: 'Гибридный график',
  description: 'Пишем на Java, гибрид: 3 дня в офисе',
  salary: 250000,
  createdAt: '2026-09-26T12:00:00Z',
};

test('пустой фильтр никого не отсекает', () => {
  assert.equal(isFilterActive(EMPTY_FEED_FILTERS), false);
  assert.equal(activeCount(EMPTY_FEED_FILTERS), 0);
  assert.equal(matchOwnVacancy(base, EMPTY_FEED_FILTERS, NOW), true);
});

test('зарплата: вакансия ниже порога не проходит', () => {
  const f = { ...EMPTY_FEED_FILTERS, salaryFrom: 300000 };
  assert.equal(isFilterActive(f), true);
  assert.equal(matchOwnVacancy(base, f, NOW), false);
  assert.equal(matchOwnVacancy({ ...base, salary: 300000 }, f, NOW), true);
});

test('зарплата null (без зарплаты) скрывается, как только выбрана сумма', () => {
  const withoutSalary = { ...base, salary: null };
  assert.equal(matchOwnVacancy(withoutSalary, EMPTY_FEED_FILTERS, NOW), true);
  assert.equal(matchOwnVacancy(withoutSalary, { ...EMPTY_FEED_FILTERS, salaryFrom: 100000 }, NOW), false);
});

test('специализация: определяется по названию, неизвестная не проходит фильтр', () => {
  const f = { ...EMPTY_FEED_FILTERS, specs: ['backend' as const] };
  assert.equal(matchOwnVacancy(base, f, NOW), true);
  assert.equal(matchOwnVacancy({ ...base, title: 'Курьер' }, f, NOW), false);
  const other = { ...EMPTY_FEED_FILTERS, specs: ['design' as const] };
  assert.equal(matchOwnVacancy(base, other, NOW), false);
});

test('уровень: без признака в названии вакансия не выдаётся за чужой уровень', () => {
  const senior = { ...EMPTY_FEED_FILTERS, levels: ['senior' as const] };
  assert.equal(matchOwnVacancy(base, senior, NOW), true);
  assert.equal(matchOwnVacancy({ ...base, title: 'Java-разработчик' }, senior, NOW), false);
});

test('формат: гибрид определяется раньше «офиса» из текста', () => {
  const hybrid = { ...EMPTY_FEED_FILTERS, formats: ['hybrid' as const] };
  assert.equal(matchOwnVacancy(base, hybrid, NOW), true);
  const office = { ...EMPTY_FEED_FILTERS, formats: ['office' as const] };
  assert.equal(matchOwnVacancy(base, office, NOW), false);
  assert.equal(matchOwnVacancy({ ...base, schedule: null, description: 'Работа в офисе' }, office, NOW), true);
});

test('компания: точное совпадение имени', () => {
  const f = { ...EMPTY_FEED_FILTERS, companies: ['Яндекс'] };
  assert.equal(matchOwnVacancy(base, f, NOW), false);
  assert.equal(matchOwnVacancy({ ...base, company: 'Яндекс' }, f, NOW), true);
});

test('дата публикации: старая вакансия не проходит короткое окно', () => {
  const weekOld = { ...base, createdAt: new Date(NOW - 8 * 86400000).toISOString() };
  assert.equal(matchOwnVacancy(weekOld, { ...EMPTY_FEED_FILTERS, posted: 'week' }, NOW), false);
  assert.equal(matchOwnVacancy(weekOld, { ...EMPTY_FEED_FILTERS, posted: 'month' }, NOW), true);
  assert.equal(matchOwnVacancy(weekOld, { ...EMPTY_FEED_FILTERS, posted: 'all' }, NOW), true);
});

test('activeCount считает включённые группы, а не число значений внутри них', () => {
  const f = { ...EMPTY_FEED_FILTERS, specs: ['backend' as const, 'frontend' as const], levels: ['senior' as const] };
  assert.equal(activeCount(f), 2);
});

test('toExtFeedFilters отдаёт форму dbGetExtFeed без изменений значений', () => {
  const f = { salaryFrom: 150000, specs: ['qa' as const], levels: [], formats: ['remote' as const], companies: ['Тинькофф'], posted: 'week' as const };
  assert.deepEqual(toExtFeedFilters(f), {
    salaryFrom: 150000, specs: ['qa'], levels: [], formats: ['remote'], companies: ['Тинькофф'], posted: 'week',
  });
});

test('склонение «вакансия»', () => {
  const cases: [number, string][] = [
    [1, 'вакансия'], [2, 'вакансии'], [5, 'вакансий'], [11, 'вакансий'],
    [21, 'вакансия'], [22, 'вакансии'], [25, 'вакансий'], [111, 'вакансий'],
  ];
  for (const [n, word] of cases) assert.equal(pluralVacancies(n), word, `n=${n}`);
});
